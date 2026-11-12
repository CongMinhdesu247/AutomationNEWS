import { WorkflowQueue } from "../workflows/queue.js";
import { DigestScheduler } from "../workflows/schedule.js";
import type { FastifyInstance } from "fastify";
import {
  requestKeySchema,
  digestIdSchema,
  paginationSchema,
  validationIssues,
} from "@hub/contracts";
import type { DigestService } from "./service.js";
import { RequestError } from "./service.js";
import type { DigestStore } from "./store.js";
import type { z } from "zod";
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new RequestError(
      400,
      "VALIDATION_ERROR",
      "Yêu cầu không hợp lệ.",
      validationIssues(parsed.error),
    );
  return parsed.data;
}
export function digestRoutes(
  app: FastifyInstance,
  store: DigestStore,
  service: DigestService,
  queue: WorkflowQueue,
) {
  app.get("/api/schedule", async () => new DigestScheduler(queue).status());
  app.get("/api/dead-letters", async (request) => {
    const { page, pageSize } = parse(paginationSchema, request.query);
    return queue.deadLetters(page, pageSize);
  });
  app.post<{ Params: { id: string } }>(
    "/api/dead-letters/:id/replay",
    async (request, reply) => {
      if (request.body !== undefined && request.body !== null)
        throw new RequestError(
          400,
          "VALIDATION_ERROR",
          "Endpoint này không nhận body.",
        );
      return reply
        .code(202)
        .send(await queue.replay(parse(digestIdSchema, request.params.id)));
    },
  );
  app.post("/api/digests", async (request, reply) => {
    const key = parse(requestKeySchema, request.headers["idempotency-key"]);
    return reply.code(202).send(await queue.submit(key, request.body));
  });
  app.get("/api/runs", async (request) => {
    const { page, pageSize } = parse(paginationSchema, request.query);
    return queue.list(page, pageSize);
  });
  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request) => {
    const run = await queue.get(parse(digestIdSchema, request.params.id));
    if (!run)
      throw new RequestError(
        404,
        "RUN_NOT_FOUND",
        "Không tìm thấy workflow run.",
      );
    return run;
  });
  app.get("/api/digests", async (request) => {
    const { page, pageSize } = parse(paginationSchema, request.query);
    return store.list(page, pageSize);
  });
  app.get<{ Params: { id: string } }>("/api/digests/:id", async (request) => {
    const id = parse(digestIdSchema, request.params.id);
    const digest = await store.get(id);
    if (!digest)
      throw new RequestError(
        404,
        "DIGEST_NOT_FOUND",
        "Không tìm thấy bản tin.",
      );
    return service.localize(digest);
  });
  app.post<{ Params: { id: string } }>(
    "/api/digests/:id/notifications",
    async (request) => {
      if (request.body !== undefined && request.body !== null)
        throw new RequestError(
          400,
          "VALIDATION_ERROR",
          "Endpoint này không nhận body.",
        );
      return service.notify(
        parse(digestIdSchema, request.params.id),
        parse(requestKeySchema, request.headers["idempotency-key"]),
      );
    },
  );
}
