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
  ConnectorError,
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
    if (isIP(address)) {
      const parsed = ipaddr.process(address);
      const allowedRange =
        parsed.kind() === "ipv6"
          ? ["private", "uniqueLocal"].includes(parsed.range()) ||
            (parsed.range() === "unicast" &&
              (parsed as ipaddr.IPv6).match(ipaddr.IPv6.parse("2000::"), 3))
          : ["unicast", "private", "uniqueLocal"].includes(parsed.range()) &&
            parsed.toString() !== "168.63.129.16";
      if (!allowedRange) return;
    }
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
    tokenOrigins,
    publicBaseUrl,
    allowedOrigins = [],
    destinationOrigins,
    signal,
    message: customMessage,
    clickUrl,
    title,
    priority,
  }: {
    http?: HttpClient;
    now?: () => Date;
    token?: string;
    tokenOrigins?: string[];
    publicBaseUrl?: string;
    allowedOrigins?: string[];
    destinationOrigins?: string[];
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
    // Keep long report URLs behind a button. A normal banner tap opens ntfy.
    const detail = clickUrl
      ? checkUrl(clickUrl).toString()
      : dashboardLink(publicBaseUrl, digest.id);
    const url = checkUrl(config.serverUrl);
    if (destinationOrigins && !destinationOrigins.includes(url.origin))
      throw new ConnectorError("NTFY_ORIGIN", "Địa chỉ ntfy chưa có trong danh sách cho phép của server.");
    url.search = "";
    url.hash = "";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    const sendToken =
      token && (!tokenOrigins || tokenOrigins.includes(url.origin))
        ? token
        : undefined;
    const response = await http(url.toString(), {
      method: "POST",
      signal,
      allowedOrigins,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(sendToken ? { Authorization: "Bearer " + sendToken } : {}),
      },
      body: JSON.stringify({
        topic: config.topic,
        title: title ?? (digest.sources && lowestMarketLabels(digest.sources).length ? "KHẨN: giá xuống thấp nhất 30 ngày" : notificationTitle(digest)),
        ...((priority || (digest.sources && lowestMarketLabels(digest.sources).length)) ? { priority: priority ?? 5 } : {}),
        message: customMessage ?? formatDigestNotification(digest),
        ...(detail ? { actions: [{ action: "view", label: "Xem chi tiết", url: detail }] } : {}),
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
