/** Timeout plus optional cancellation, with deterministic cleanup so completed requests never leak timers. */
export function createRequestSignal(
  milliseconds: number,
  parent?: AbortSignal | null,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const cancel = () => {
    clearTimeout(timer);
    controller.abort(parent?.reason);
  };
  const timer = setTimeout(() => {
    parent?.removeEventListener("abort", cancel);
    controller.abort(
      new DOMException(
        "Yêu cầu quá thời gian chờ. Vui lòng thử lại.",
        "TimeoutError",
      ),
    );
  }, milliseconds);
  if (parent?.aborted) cancel();
  else parent?.addEventListener("abort", cancel, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", cancel);
    },
  };
}

export function requestSignal(
  milliseconds: number,
  parent?: AbortSignal | null,
): AbortSignal {
  return createRequestSignal(milliseconds, parent).signal;
}
