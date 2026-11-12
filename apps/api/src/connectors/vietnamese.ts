import { createHash } from "node:crypto";
import { franc } from "franc-min";
import { z } from "zod";
import type { GithubData, Repository } from "@hub/contracts";
import { safeHttp, type HttpClient } from "./http.js";
import { plainText } from "./rss.js";

export type TranslationCache = Record<
  string,
  { text: string; createdAt: string }
>;
const languages: Record<string, string> = {
  eng: "en",
  cmn: "zh-CN",
  jpn: "ja",
  kor: "ko",
  vie: "vi",
  fra: "fr",
  spa: "es",
  deu: "de",
  por: "pt",
  ita: "it",
  rus: "ru",
  ukr: "uk",
  ind: "id",
  tur: "tr",
  ara: "ar",
  pol: "pl",
  nld: "nl",
  tha: "th",
};
const clean = (text: string) =>
  text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const vietnameseMarks = /[ăđơưảạấầẩẫậắằẳẵặẻẽẹếềểễệỉịỏọốồổỗộớờởỡợủụứừửữựỷỹỵ]/i;
export function descriptionLanguage(text: string): string | undefined {
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/\p{Script=Han}/u.test(text)) return "zh-CN";
  if (vietnameseMarks.test(text)) return "vi";
  if (
    (
      text.match(
        /\b(the|and|for|with|that|your|from|using|library|tool|model|framework|build|runs|open-source)\b/gi,
      ) ?? []
    ).length >= 2
  )
    return "en";
  const detected =
    languages[franc(text, { minLength: 15, only: Object.keys(languages) })];
  return detected ?? (/^[\x20-\x7e]+$/.test(text) ? "en" : undefined);
}
export function translationSegment(value: string) {
  const original = clean(value);
  let text = "";
  for (const character of original) {
    if (Buffer.byteLength(text + character) > 450) break;
    text += character;
  }
  if (text.length < original.length) {
    const boundary = Math.max(
      text.lastIndexOf(". "),
      text.lastIndexOf("。"),
      text.lastIndexOf("; "),
    );
    if (boundary > text.length / 2) text = text.slice(0, boundary + 1);
    else if (
      !/\p{Script=Han}/u.test(text) &&
      text.lastIndexOf(" ") > text.length / 2
    )
      text = text.slice(0, text.lastIndexOf(" "));
  }
  return text;
}
const responseSchema = z.object({
  responseStatus: z.literal(200),
  quotaFinished: z.boolean().optional(),
  responseData: z.object({ translatedText: z.string().min(1).max(6000) }),
});
export function createVietnameseSummarizer({
  http = safeHttp,
  now = () => new Date(),
  cache = {},
}: { http?: HttpClient; now?: () => Date; cache?: TranslationCache } = {}) {
  const pending = new Map<string, Promise<string | undefined>>();
  let cooldownUntil = 0;
  let sentCharacters = 0;
  let budgetDay = "";
  async function translate(
    source: string,
    language: string,
    signal: AbortSignal,
  ) {
    const key = createHash("sha256")
      .update(language + "\n" + source)
      .digest("hex");
    const saved = cache[key];
    if (
      saved &&
      now().getTime() - Date.parse(saved.createdAt) < 30 * 86400000 &&
      saved.text.trim()
    )
      return saved.text;
    if (now().getTime() < cooldownUntil || signal.aborted) return;
    if (pending.has(key)) return pending.get(key);
    const today = now().toISOString().slice(0, 10);
    if (budgetDay !== today) {
      budgetDay = today;
      sentCharacters = 0;
    }
    const segment = translationSegment(source);
    // Below the provider's anonymous daily limit; never register a paid fallback.
    if (sentCharacters + Array.from(segment).length > 3500) return;
    sentCharacters += Array.from(segment).length;
    const operation = (async () => {
      try {
        const url = new URL("https://api.mymemory.translated.net/get");
        url.search = new URLSearchParams({
          q: segment,
          langpair: language + "|vi",
          mt: "1",
        }).toString();
        const response = await http(url.toString(), {
          signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
          timeoutMs: 3000,
          maxBytes: 100000,
        });
        if (response.status !== 200) throw new Error("Translation unavailable");
        const data = responseSchema.parse(JSON.parse(response.body));
        if (data.quotaFinished) throw new Error("Translation quota");
        const text = clean(plainText(data.responseData.translatedText, 320));
        if (
          !text ||
          /MYMEMORY WARNING|INVALID LANGUAGE|QUERY LENGTH LIMIT|NO QUERY SPECIFIED/i.test(
            text,
          )
        )
          throw new Error("Invalid translation");
        cache[key] = { text, createdAt: now().toISOString() };
        const keys = Object.keys(cache);
        if (keys.length > 150)
          for (const old of keys
            .sort((a, b) =>
              cache[a]!.createdAt.localeCompare(cache[b]!.createdAt),
            )
            .slice(0, keys.length - 150))
            delete cache[old];
        return text;
      } catch {
        cooldownUntil = now().getTime() + 60000;
        return undefined;
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, operation);
    return operation;
  }
  async function repository<T extends Repository>(
    repo: T,
    signal: AbortSignal,
  ): Promise<T> {
    if (
      repo.summaryVi &&
      (repo.summaryViStatus === "translated" ||
        repo.summaryViStatus === "original_vi")
    )
      return repo;
    const description = clean(repo.description ?? "");
    if (!description)
      return {
        ...repo,
        summaryVi: "Tác giả chưa cung cấp mô tả cho dự án này.",
        summaryViStatus: "missing",
      };
    const language = descriptionLanguage(description);
    if (language === "vi")
      return {
        ...repo,
        summaryVi: description.slice(0, 320),
        summaryViStatus: "original_vi",
      };
    const text = language
      ? await translate(description, language, signal)
      : undefined;
    return {
      ...repo,
      summaryVi:
        text ?? "Chưa dịch được mô tả. Bạn có thể xem bản gốc trên GitHub.",
      summaryViStatus: text ? "translated" : "unavailable",
    };
  }
  return async (
    data: GithubData,
    parentSignal?: AbortSignal,
  ): Promise<GithubData> => {
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, AbortSignal.timeout(9000)])
      : AbortSignal.timeout(9000);
    // Only translate repositories actually selected for the digest, never all search candidates.
    const result: GithubData = { ...data, rising: [], newNotable: [] };
    for (const repo of data.rising)
      result.rising.push(await repository(repo, signal));
    for (const repo of data.newNotable)
      result.newNotable.push(await repository(repo, signal));
    return result;
  };
}
