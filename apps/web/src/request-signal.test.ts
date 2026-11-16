import { afterEach, expect, it, vi } from "vitest";
import { requestSignal } from "./request-signal";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("times out without either static AbortSignal method, as on older Safari", () => {
  vi.useFakeTimers();
  vi.stubGlobal("AbortSignal", {});
  const signal = requestSignal(10000);
  vi.advanceTimersByTime(9999);
  expect(signal.aborted).toBe(false);
  vi.advanceTimersByTime(1);
  expect(signal.aborted).toBe(true);
  expect(signal.reason.name).toBe("TimeoutError");
});
it("cancels on navigation and removes the pending timeout", () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  const signal = requestSignal(10000, parent.signal);
  parent.abort(new DOMException("Navigation", "AbortError"));
  expect(signal.reason).toBe(parent.signal.reason);
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("honors a parent already aborted before starting", () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  parent.abort();
  expect(requestSignal(10000, parent.signal).aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("detaches the parent listener after timeout", () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  const remove = vi.spyOn(parent.signal, "removeEventListener");
  const signal = requestSignal(10, parent.signal);
  vi.advanceTimersByTime(10);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  parent.abort();
  expect(signal.reason.name).toBe("TimeoutError");
});
