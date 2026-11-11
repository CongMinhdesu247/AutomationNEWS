import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { ServerResponse } from "node:http";
import { cursor, cursorSequence, digestIdSchema } from "@hub/contracts";
import { eventDto, type EventRow } from "./store.js";
import { RequestError } from "../digests/service.js";
export type SseOptions = {
  pollMs?: number;
  heartbeatMs?: number;
  maxClients?: number;
  maxRuns?: number;
  maxBufferBytes?: number;
};
type Client = {
  runId: string;
  sequence: bigint;
  response: ServerResponse;
  lastSync: string;
  lastBeat: number;
  blocked: boolean;
  blockedAt: number;
  drain: () => void;
  cleanup: () => void;
};
export function writeFrame(
  response: ServerResponse,
  frame: string,
  maxBytes = 65536,
): boolean {
  if (response.destroyed || response.writableEnded) return false;
  if (response.writableLength + Buffer.byteLength(frame) > maxBytes) {
    response.destroy();
    return false;
  }
  if (!response.write(frame)) return false;
  return true;
}
export class RunEventHub {
  private clients = new Set<Client>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;
  private closed = false;
  constructor(
    private pool: Pool,
    private options: SseOptions = {},
  ) {}
  stats() {
    return {
      clients: this.clients.size,
      runs: new Set([...this.clients].map((c) => c.runId)).size,
      timerActive: Boolean(this.timer),
      polling: this.polling,
    };
  }
  capacity(runId: string) {
    return (
      !this.closed &&
      this.clients.size < (this.options.maxClients ?? 100) &&
      (this.stats().runs < (this.options.maxRuns ?? 50) ||
        [...this.clients].some((c) => c.runId === runId))
    );
  }
  attach(runId: string, sequence: bigint, response: ServerResponse) {
    const cleanup = () => {
      this.clients.delete(client);
      response.off("close", cleanup);
      response.off("error", cleanup);
      response.off("drain", client.drain);
      if (!this.clients.size) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    };
    const client: Client = {
      runId,
      sequence,
      response,
      lastSync: "",
      lastBeat: Date.now(),
      blocked: false,
      blockedAt: 0,
      drain: () => {
        client.blocked = false;
        this.schedule(0);
      },
      cleanup,
    };
    this.clients.add(client);
    response.on("close", cleanup);
    response.on("error", cleanup);
    if (!this.send(client, "retry: 1500\n: connected\n\n")) return;
    this.schedule(0);
  }
  private send(client: Client, frame: string) {
    if (client.blocked) return false;
    const written = writeFrame(
      client.response,
      frame,
      this.options.maxBufferBytes ?? 65536,
    );
    if (client.response.destroyed || client.response.writableEnded) {
      client.cleanup();
      return false;
    }
    if (!written) {
      client.blocked = true;
      client.blockedAt = Date.now();
      client.response.once("drain", client.drain);
    }
    return true;
  }
  private reset(client: Client, code: string) {
    this.send(
      client,
      "event: reset\ndata: " +
        JSON.stringify({ code, snapshotUrl: "/api/runs/" + client.runId }) +
        "\n\n",
    );
    client.response.end();
    client.cleanup();
  }
  private schedule(delay = this.options.pollMs ?? 500) {
    if (!this.closed && this.clients.size && !this.timer && !this.polling)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.poll();
      }, delay);
  }
  private async poll() {
    if (this.polling || this.closed || !this.clients.size) return;
    this.polling = true;
    try {
      const groups = new Map<string, bigint>();
      for (const client of [...this.clients])
        if (client.blocked && Date.now() - client.blockedAt > 10000) {
          client.response.destroy();
          client.cleanup();
        }
      const batchClients = [...this.clients].filter(
        (client) => !client.blocked,
      );
      for (const client of batchClients) {
        if (client.blocked) continue;
        const previous = groups.get(client.runId);
        if (previous === undefined || client.sequence < previous)
          groups.set(client.runId, client.sequence);
      }
      if (!groups.size) return;
      // One bounded read per run, shared by all clients in this API process.
      const result = await this.pool.query<{
        id: string;
        high: string;
        status: string;
        events: EventRow[];
      }>(
        `SELECT r.id,r.event_sequence::text AS high,r.status,coalesce(e.events,'[]'::jsonb) AS events
         FROM jsonb_to_recordset($1::jsonb) AS w(id uuid,after bigint)
         JOIN workflow_runs r ON r.id=w.id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(to_jsonb(recent) ORDER BY recent.sequence::bigint) AS events FROM (
             SELECT run_id,sequence::text AS sequence,type,occurred_at,node_id,payload
             FROM run_events WHERE run_id=r.id AND sequence>w.after ORDER BY run_events.sequence LIMIT 100
           ) recent
         ) e ON true`,
        [
          JSON.stringify(
            [...groups].map(([id, after]) => ({ id, after: String(after) })),
          ),
        ],
      );
      if (this.closed) return;
      const found = new Set<string>();
      for (const row of result.rows) {
        found.add(row.id);
        const high = BigInt(row.high);
        const events = row.events
          .map(eventDto)
          .sort((a, b) => (BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1));
        for (const client of batchClients.filter(
          (c) => c.runId === row.id && this.clients.has(c) && !c.blocked,
        )) {
          if (client.sequence > high) {
            this.reset(client, "CURSOR_OUT_OF_RANGE");
            continue;
          }
          let valid = true;
          let sentBytes = 0;
          let yielded = false;
          for (const event of events) {
            const sequence = BigInt(event.sequence);
            if (sequence <= client.sequence) continue;
            if (sequence !== client.sequence + 1n) {
              this.reset(client, "EVENT_GAP");
              valid = false;
              break;
            }
            const frame =
              "id: " +
              event.id +
              "\nevent: run-event\ndata: " +
              JSON.stringify(event) +
              "\n\n";
            // Yield between small bursts so a healthy socket can flush before
            // hitting our buffer cap (which can precede Node's highWaterMark).
            const bytes = Buffer.byteLength(frame);
            if (sentBytes && sentBytes + bytes > 16384) {
              yielded = true;
              break;
            }
            if (!this.send(client, frame)) {
              valid = false;
              break;
            }
            sentBytes += bytes;
            client.sequence = sequence;
            if (client.blocked) break;
          }
          if (!valid || client.blocked) continue;
          if (!yielded && client.sequence < high && events.length < 100) {
            this.reset(client, "EVENT_GAP");
            continue;
          }
          if (client.sequence === high) {
            const terminal = ["completed", "failed"].includes(row.status);
            const signature = row.high + ":" + terminal;
            if (client.lastSync !== signature) {
              if (
                !this.send(
                  client,
                  "event: sync\ndata: " +
                    JSON.stringify({
                      cursor: cursor(row.id, row.high),
                      terminal,
                    }) +
                    "\n\n",
                )
              )
                continue;
              client.lastSync = signature;
            }
            if (terminal) {
              if (!client.blocked) {
                client.response.end();
                client.cleanup();
              }
              continue;
            }
          }
          if (
            Date.now() - client.lastBeat >=
            (this.options.heartbeatMs ?? 15000)
          ) {
            if (
              this.send(
                client,
                ": heartbeat " + new Date().toISOString() + "\n\n",
              )
            )
              client.lastBeat = Date.now();
          }
        }
      }
      for (const client of batchClients)
        if (
          this.clients.has(client) &&
          !client.blocked &&
          !found.has(client.runId)
        )
          this.reset(client, "RUN_REMOVED");
    } catch {
      for (const client of [...this.clients]) {
        client.response.destroy();
        client.cleanup();
      }
    } finally {
      this.polling = false;
      this.schedule();
    }
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const client of [...this.clients]) {
      client.response.end();
      client.cleanup();
    }
  }
}
export function registerRunEvents(
  app: FastifyInstance,
  pool: Pool,
  options: SseOptions = {},
) {
  const hub = new RunEventHub(pool, options);
  app.addHook("preClose", async () => hub.close());
  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>(
    "/api/runs/:id/events",
    async (request, reply) => {
      const parsed = digestIdSchema.safeParse(request.params.id);
      if (!parsed.success)
        throw new RequestError(400, "VALIDATION_ERROR", "ID run không hợp lệ.");
      const id = parsed.data.toLowerCase();
      if (
        !(await pool.query("SELECT id FROM workflow_runs WHERE id=$1", [id]))
          .rows[0]
      )
        throw new RequestError(
          404,
          "RUN_NOT_FOUND",
          "Không tìm thấy workflow run.",
        );
      const value =
        request.headers["last-event-id"] ??
        request.query.cursor ??
        cursor(id, "0");
      let sequence: bigint;
      try {
        if (typeof value !== "string") throw new Error("Invalid cursor");
        sequence = cursorSequence(value, id);
      } catch {
        throw new RequestError(
          400,
          "INVALID_EVENT_CURSOR",
          "Cursor không hợp lệ hoặc thuộc run khác.",
        );
      }
      if (!hub.capacity(id))
        throw new RequestError(
          429,
          "SSE_CAPACITY",
          "Đã đạt giới hạn kết nối trực tiếp. Vui lòng thử lại sau.",
        );
      if (reply.raw.destroyed) return;
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.flushHeaders();
      hub.attach(id, sequence, reply.raw);
    },
  );
  return hub;
}
