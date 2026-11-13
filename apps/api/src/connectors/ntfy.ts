import { isIP } from "node:net";
import { lowestMarketLabels } from "./market-history.js";
import ipaddr from "ipaddr.js";
import type { Settings, Digest, SourceResult } from "@hub/contracts";
import {
  formatDigestNotification,
  notificationTitle,
} from "../notifications/format.js";
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
    message: customMessage,
    clickUrl,
    title,
    priority,
  }: {
    http?: HttpClient;
    now?: () => Date;
    token?: string;
    publicBaseUrl?: string;
    allowedOrigins?: string[];
    signal: AbortSignal;
    message?: string;
    clickUrl?: string;
    title?: string;
    priority?: 5;
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
    // Detail links stay in the message. A normal banner tap opens ntfy.
    const detail = clickUrl
      ? checkUrl(clickUrl).toString()
      : dashboardLink(publicBaseUrl, digest.id);
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
        title: title ?? (digest.sources && lowestMarketLabels(digest.sources).length ? "KHẨN: giá xuống thấp nhất 30 ngày" : notificationTitle(digest)),
        ...((priority || (digest.sources && lowestMarketLabels(digest.sources).length)) ? { priority: priority ?? 5 } : {}),
        message: customMessage ?? formatDigestNotification(digest, false, false, false, detail ? "Bản web (tùy chọn):\n" + detail : ""),
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
