import { it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import type { Pool } from "pg";
import { RunEventHub, writeFrame } from "./sse.js";
import { telemetryError } from "./store.js";
import { cursorSequence } from "@hub/contracts";
it("never copies raw source messages, headers or unknown error codes to telemetry", () => {
  expect(
    telemetryError({
      code: "HTTP_503",
      message: "Authorization: secret",
      token: "secret",
    }),
  ).toEqual({
    code: "HTTP_503",
    message: "Tác vụ không thành công; thông tin chi tiết đã được làm sạch.",
  });
  expect(
    telemetryError({ code: "secret-token", message: "private response" }),
  ).toMatchObject({ code: "NODE_ERROR" });
});
it("signals backpressure and closes an over-limit reader without growing a buffer", () => {
  const response = {
    destroyed: false,
    writableEnded: false,
    writableLength: 0,
    write: vi.fn(() => false),
    destroy: vi.fn(),
  } as unknown as ServerResponse;
  expect(writeFrame(response, "frame")).toBe(false);
  expect(response.destroy).not.toHaveBeenCalled();
  const full = {
    ...response,
    writableLength: 65536,
    write: vi.fn(),
    destroy: vi.fn(),
  } as unknown as ServerResponse;
  expect(writeFrame(full, "x")).toBe(false);
  expect(full.write).not.toHaveBeenCalled();
});
it("disconnect removes listeners and the shared idle timer", () => {
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writableLength: 0,
    write: () => true,
    destroy() {
      this.destroyed = true;
    },
    end() {},
  }) as unknown as ServerResponse;
  const hub = new RunEventHub({} as Pool, { maxClients: 1, maxRuns: 1 });
  hub.attach("run", 0n, response);
  expect(hub.stats().clients).toBe(1);
  expect(hub.capacity("another")).toBe(false);
  response.emit("close");
  expect(hub.stats().clients).toBe(0);
  expect(hub.capacity("another")).toBe(true);
  expect(hub.stats().timerActive).toBe(false);
  expect(response.listenerCount("close")).toBe(0);
  hub.close();
});
it("validates numeric range and run-scoped cursor identity", () => {
  const id = crypto.randomUUID();
  expect(cursorSequence(id + ":0", id)).toBe(0n);
  for (const value of [
    id + ":-1",
    id + ":01",
    id + ":9223372036854775808",
    crypto.randomUUID() + ":1",
  ])
    expect(() => cursorSequence(value, id)).toThrow();
});

it("keeps clients attaching during a shared read for the next batch", async () => {
  let release: (value: unknown) => void = () => {};
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pool = {
    query: () => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  } as unknown as Pool;
  const response = () =>
    Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      writableLength: 0,
      write: vi.fn(() => true),
      destroy() {
        this.destroyed = true;
      },
      end() {},
    }) as unknown as ServerResponse;
  const hub = new RunEventHub(pool, { pollMs: 100 });
  const first = response();
  const second = response();
  hub.attach("first", 0n, first);
  await started;
  hub.attach("second", 0n, second);
  release({ rows: [{ id: "first", high: "0", status: "queued", events: [] }] });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(hub.stats().clients).toBe(2);
  expect(second.write).not.toHaveBeenCalledWith(
    expect.stringContaining("RUN_REMOVED"),
  );
  hub.close();
});
