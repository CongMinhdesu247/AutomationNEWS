import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import type { Settings, Digest, SourceResult } from "@hub/contracts";
import {
  safeHttp,
  ensureOk,
  cleanError,
  checkUrl,
  type HttpClient,
} from "./http.js";
export function dashboardLink(
  base: string | undefined,
  id: string,
): string | undefined {
  if (!base) return;
  try {
    const url = checkUrl(base);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const address = host.replace(/^\[|\]$/g, "");
    if (
      isIP(address) &&
      !["unicast", "private", "uniqueLocal"].includes(
        ipaddr.process(address).range(),
      )
    )
      return;
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      url.search ||
      url.hash
    )
      return;
    url.pathname = url.pathname.replace(/\/$/, "") + "/";
    url.hash = "/digests/" + id;
    return url.toString();
  } catch {
    return;
  }
}
const statusLabel = {
  success: "thành công",
  partial: "một phần",
  failed: "thất bại",
  running: "đang tạo",
};
export async function sendNtfy(
  digest: Digest,
  config: Settings["notifications"],
  {
    http = safeHttp,
    now = () => new Date(),
    token,
    publicBaseUrl,
    allowedOrigins = [],
    signal,
  }: {
    http?: HttpClient;
    now?: () => Date;
    token?: string;
    publicBaseUrl?: string;
    allowedOrigins?: string[];
    signal: AbortSignal;
  },
): Promise<SourceResult<null>> {
  if (!config.enabled)
    return {
      status: "disabled",
      fetchedAt: now().toISOString(),
      data: null,
      errors: [],
    };
  try {
    const sources = digest.sources;
    const weather = sources?.weather.data;
    const message =
      "Bản tin đã lưu: " +
      (sources?.rss.data.items.length ?? 0) +
      " tin; " +
      (weather
        ? (weather.minTemperature ?? "?") +
          "–" +
          (weather.maxTemperature ?? "?") +
          " °C" +
          (weather.umbrella ? " (nên mang ô)" : "")
        : "chưa có thời tiết") +
      "; " +
      ((sources?.github.data.rising.length ?? 0) +
        (sources?.github.data.newNotable.length ?? 0)) +
      " repository. Trạng thái: " +
      statusLabel[digest.status] +
      ".";
    const click = dashboardLink(publicBaseUrl, digest.id);
    const url = checkUrl(config.serverUrl);
    url.search = "";
    url.hash = "";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    const response = await http(url.toString(), {
      method: "POST",
      signal,
      allowedOrigins,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify({
        topic: config.topic,
        title: "Bản tin cá nhân",
        message,
        ...(click ? { click } : {}),
      }),
      maxBytes: 65536,
    });
    ensureOk(response);
    return {
      status: "success",
      fetchedAt: now().toISOString(),
      data: null,
      errors: [],
    };
  } catch (error) {
    return {
      status: "failed",
      fetchedAt: now().toISOString(),
      data: null,
      errors: [cleanError(error)],
    };
  }
}
