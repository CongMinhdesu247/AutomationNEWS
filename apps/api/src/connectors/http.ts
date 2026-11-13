import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
export class ConnectorError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryAt?: string,
  ) {
    super(message);
  }
}
export type HttpOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  allowedOrigins?: string[];
};
export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};
export type HttpClient = (
  url: string,
  options?: HttpOptions,
) => Promise<HttpResponse>;
export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return (
      parsed.range() === "unicast" && parsed.toString() !== "168.63.129.16"
    );
  } catch {
    return false;
  }
}
function trustedAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    const range = parsed.range();
    return (
      ["unicast", "private", "uniqueLocal", "loopback"].includes(range) &&
      parsed.toString() !== "168.63.129.16"
    );
  } catch {
    return false;
  }
}
export function checkUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorError("INVALID_URL", "URL không hợp lệ.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new ConnectorError(
      "INVALID_URL",
      "Chỉ nhận HTTP/HTTPS không chứa thông tin đăng nhập.",
    );
  return url;
}
export async function resolveTarget(
  url: URL,
  allowedOrigins: string[] = [],
  resolve = lookup,
) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolve(hostname, { all: true, verbatim: true });
  const trusted = allowedOrigins.includes(url.origin);
  if (
    !addresses.length ||
    addresses.some(
      (entry) =>
        !(trusted
          ? trustedAddress(entry.address)
          : isPublicAddress(entry.address)),
    )
  )
    throw new ConnectorError(
      "BLOCKED_ADDRESS",
      "Đích truy cập bị chặn bởi chính sách địa chỉ mạng.",
    );
  return addresses[0]!;
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new ConnectorError("TIMEOUT", "Nguồn vượt thời gian cho phép."));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
export const safeHttp: HttpClient = async (value, options = {}) => {
  const signal = options.signal
    ? AbortSignal.any([
        options.signal,
        AbortSignal.timeout(options.timeoutMs ?? 6000),
      ])
    : AbortSignal.timeout(options.timeoutMs ?? 6000);
  let url = checkUrl(value);
  for (let redirect = 0; ; redirect++) {
    signal.throwIfAborted();
    const address = await abortable(
      resolveTarget(url, options.allowedOrigins),
      signal,
    );
    signal.throwIfAborted();
    const response = await new Promise<HttpResponse>((resolve, reject) => {
      const req = (url.protocol === "https:" ? https : http).request(
        url,
        {
          method: options.method ?? "GET",
          agent: false,
          family: address.family,
          signal,
          headers: {
            "Accept-Encoding": "identity",
            "User-Agent": "PersonalAutomationHub/1.0.0",
            ...options.headers,
          },
          // Pin the validated IP for this connection; never resolve again in the socket.
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
        },
        (res) => {
          const headers = Object.fromEntries(
            Object.entries(res.headers).map(([key, val]) => [
              key,
              Array.isArray(val) ? val.join(",") : (val ?? ""),
            ]),
          );
          const limit = options.maxBytes ?? 2 * 1024 * 1024;
          if (
            Number(headers["content-length"]) > limit ||
            (headers["content-encoding"] &&
              headers["content-encoding"] !== "identity")
          ) {
            res.destroy();
            reject(
              new ConnectorError(
                "RESPONSE_LIMIT",
                "Response quá lớn hoặc encoding không được hỗ trợ.",
              ),
            );
            return;
          }
          let bytes = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > limit) {
              res.destroy(
                new ConnectorError(
                  "RESPONSE_LIMIT",
                  "Response vượt giới hạn dung lượng.",
                ),
              );
            } else chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 502,
              headers,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      req.on("error", reject);
      if (options.body) req.write(options.body);
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (
        options.method === "POST" ||
        redirect >= (options.maxRedirects ?? 0) ||
        !response.headers.location
      )
        throw new ConnectorError(
          "REDIRECT_LIMIT",
          "Redirect không được phép hoặc vượt giới hạn.",
        );
      url = checkUrl(new URL(response.headers.location, url).toString());
      continue;
    }
    return response;
  }
};
export function ensureOk(response: HttpResponse) {
  if (response.status < 200 || response.status >= 300)
    throw new ConnectorError(
      "HTTP_" + response.status,
      "Nguồn trả lỗi HTTP " + response.status + ".",
      retryAfterAt(response.headers["retry-after"]),
    );
}
export function retryAfterAt(
  value: string | undefined,
  now = Date.now(),
): string | undefined {
  if (!value) return;
  const at = /^\d+$/.test(value)
    ? now + Number(value) * 1000
    : Date.parse(value);
  if (Number.isFinite(at) && at >= 0 && at <= 8640000000000000)
    return new Date(at).toISOString();
}
export function cleanError(error: unknown) {
  return error instanceof ConnectorError
    ? {
        code: error.code,
        message: error.message,
        ...(error.retryAt ? { retryAt: error.retryAt } : {}),
      }
    : {
        code: "SOURCE_UNAVAILABLE",
        message: "Không lấy được dữ liệu nguồn trong giới hạn cho phép.",
      };
}
