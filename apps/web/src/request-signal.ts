/** Timeout plus optional cancellation, including Safari without AbortSignal.any/timeout. */
export function requestSignal(
  milliseconds: number,
  parent?: AbortSignal | null,
): AbortSignal {
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
  return controller.signal;
}
