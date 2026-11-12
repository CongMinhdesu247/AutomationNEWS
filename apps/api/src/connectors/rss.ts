import Parser from "rss-parser";
import { convert } from "html-to-text";
import {
  normalizeUrl,
  type Settings,
  type SourceResult,
  type RssData,
  type NewsItem,
} from "@hub/contracts";
import {
  safeHttp,
  ensureOk,
  cleanError,
  checkUrl,
  ConnectorError,
  type HttpClient,
} from "./http.js";
export function articleUrl(value: string): string {
  const url = checkUrl(value);
  for (const key of [...url.searchParams.keys()])
    if (
      /^utm_/i.test(key) ||
      [
        "fbclid",
        "gclid",
        "dclid",
        "msclkid",
        "mc_cid",
        "mc_eid",
        "igshid",
      ].includes(key.toLowerCase())
    )
      url.searchParams.delete(key);
  return normalizeUrl(url.toString());
}
export function plainText(value: string, max = 400): string {
  return convert(value, {
    wordwrap: false,
    limits: { maxInputLength: 100000 },
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
    ],
  })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
export async function fetchRss(
  config: Settings["rss"],
  {
    http = safeHttp,
    now = () => new Date(),
    signal,
  }: { http?: HttpClient; now?: () => Date; signal: AbortSignal },
): Promise<SourceResult<RssData>> {
  const feeds = config.filter((feed) => feed.enabled);
  const data: RssData = {
    items: [],
    skippedInvalidDate: 0,
    skippedInvalidItem: 0,
    feedsSucceeded: 0,
    feedsTotal: feeds.length,
  };
  const errors: SourceResult<RssData>["errors"] = [];
  const results: NewsItem[][] = Array.from({ length: feeds.length }, () => []);
  let next = 0;
  const cutoff = now().getTime() - 86400000;
  const parser = new Parser();
  await Promise.all(
    Array.from({ length: Math.min(3, feeds.length) }, async () => {
      while (next < feeds.length) {
        const index = next++;
        const feed = feeds[index]!;
        try {
          signal.throwIfAborted();
          const response = await http(feed.url, { signal, maxRedirects: 3 });
          ensureOk(response);
          if (
            /^(?:<!doctype\s+html\b|<html(?:\s|>))/i.test(
              response.body.trimStart(),
            )
          )
            throw new ConnectorError(
              "NOT_RSS_FEED",
              "URL này trả về trang web HTML, không phải luồng RSS/Atom. Hãy dùng link RSS của nguồn báo thay vì trang chủ.",
            );
          if (/<!DOCTYPE|<!ENTITY/i.test(response.body))
            throw new ConnectorError(
              "UNSAFE_XML",
              "RSS chứa khai báo XML không được hỗ trợ.",
            );
          const parsed = await parser.parseString(response.body);
          data.feedsSucceeded++;
          for (const item of parsed.items) {
            const published = Date.parse(item.isoDate ?? item.pubDate ?? "");
            if (!Number.isFinite(published)) {
              data.skippedInvalidDate++;
              continue;
            }
            if (published < cutoff || published > now().getTime()) continue;
            try {
              const title = plainText(item.title ?? "", 240);
              const url = articleUrl(item.link ?? "");
              if (!title) throw new Error("empty");
              results[index]!.push({
                id: item.guid?.trim().slice(0, 500) || url,
                title,
                source: feed.name,
                url,
                publishedAt: new Date(published).toISOString(),
                description: plainText(
                  item.content ?? item.summary ?? item.contentSnippet ?? "",
                ),
              });
            } catch {
              data.skippedInvalidItem++;
            }
          }
        } catch (error) {
          errors.push({ ...cleanError(error), source: feed.name });
        }
      }
    }),
  );
  const ids = new Set<string>();
  const urls = new Set<string>();
  data.items = results
    .flat()
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .filter((item) => {
      if (ids.has(item.id) || urls.has(item.url)) return false;
      ids.add(item.id);
      urls.add(item.url);
      return true;
    })
    .slice(0, 10);
  return {
    status: !feeds.length
      ? "disabled"
      : !data.feedsSucceeded
        ? "failed"
        : errors.length
          ? "partial"
          : "success",
    fetchedAt: now().toISOString(),
    data,
    errors,
  };
}
