import { expect, it } from "vitest";
import {
  createVietnameseSummarizer,
  descriptionLanguage,
  translationSegment,
  type TranslationCache,
} from "./vietnamese.js";
import { emptyGithub } from "./github.js";
import type { GithubData, Repository } from "@hub/contracts";
const at = new Date("2026-11-12T00:00:00Z");
const repository = (
  description = "A small OCR model that runs on CPU and extracts text from images.",
): Repository => ({
  id: 1,
  name: "fixture/ocr",
  description,
  language: "Python",
  url: "https://github.com/fixture/ocr",
  stars: 100,
  createdAt: at.toISOString(),
  fetchedAt: at.toISOString(),
});
const data = (...repos: Repository[]): GithubData => ({
  ...emptyGithub(),
  newNotable: repos,
});
const response = (
  text = "Mô hình OCR nhỏ chạy trên CPU và trích xuất văn bản từ hình ảnh.",
) => ({
  status: 200,
  headers: {},
  body: JSON.stringify({
    responseStatus: 200,
    responseData: { translatedText: text },
  }),
});

it("detects common description languages independently from programming languages", () => {
  expect(descriptionLanguage(repository().description!)).toBe("en");
  expect(
    descriptionLanguage("创业公司做 AI 产品的 7 步 Agent Skill 合集"),
  ).toBe("zh-CN");
  expect(descriptionLanguage("画像からテキストを抽出するツール")).toBe("ja");
  expect(descriptionLanguage("이미지에서 텍스트를 추출하는 도구")).toBe("ko");
  expect(descriptionLanguage("Thư viện trích xuất văn bản từ ảnh")).toBe("vi");
});
it("keeps UTF-8 input below the documented 500-byte provider limit", () => {
  const segment = translationSegment("🔥 中文 mô tả ".repeat(200));
  expect(Buffer.byteLength(segment)).toBeLessThanOrEqual(450);
  expect(segment).not.toContain("�");
});
it("translates selected repos, preserves originals and never sends tokens or settings", async () => {
  const cache: TranslationCache = {};
  let calls = 0;
  const summarize = createVietnameseSummarizer({
    cache,
    now: () => at,
    http: async (url, options) => {
      calls++;
      const target = new URL(url);
      expect(target.hostname).toBe("api.mymemory.translated.net");
      expect(target.searchParams.get("langpair")).toBe("en|vi");
      expect(
        Buffer.byteLength(target.searchParams.get("q")!),
      ).toBeLessThanOrEqual(450);
      expect(options?.headers?.Authorization).toBeUndefined();
      return response();
    },
  });
  const original = data(repository());
  const result = await summarize(original);
  expect(result.newNotable[0]).toMatchObject({
    description: original.newNotable[0]!.description,
    summaryViStatus: "translated",
    summaryVi:
      "Mô hình OCR nhỏ chạy trên CPU và trích xuất văn bản từ hình ảnh.",
  });
  expect(original.newNotable[0]).not.toHaveProperty("summaryVi");
  await summarize(original);
  expect(calls).toBe(1);
  const restored = createVietnameseSummarizer({
    cache: structuredClone(cache),
    now: () => at,
    http: async () => {
      throw new Error("Cache should avoid HTTP");
    },
  });
  expect((await restored(original)).newNotable[0]!.summaryViStatus).toBe(
    "translated",
  );
});
it("invalidates cache when original text changes and shares in-flight requests", async () => {
  let calls = 0;
  const summarize = createVietnameseSummarizer({
    http: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response();
    },
  });
  await Promise.all([
    summarize(data(repository())),
    summarize(data(repository())),
  ]);
  expect(calls).toBe(1);
  await summarize(
    data(repository("A library for developers to extract text from images.")),
  );
  expect(calls).toBe(2);
});
it("keeps Vietnamese descriptions without HTTP and honestly marks missing descriptions", async () => {
  const summarize = createVietnameseSummarizer({
    http: async () => {
      throw new Error("No network needed");
    },
  });
  const result = await summarize(
    data(repository("Thư viện xử lý ảnh mã nguồn mở"), {
      ...repository(),
      id: 2,
      description: null,
    }),
  );
  expect(result.newNotable[0]!.summaryViStatus).toBe("original_vi");
  expect(result.newNotable[1]!).toMatchObject({
    summaryViStatus: "missing",
    summaryVi: expect.stringContaining("chưa cung cấp mô tả"),
  });
});
it("does not present quota/errors as translations and still returns readable Vietnamese fallback", async () => {
  let calls = 0;
  const summarize = createVietnameseSummarizer({
    http: async () => {
      calls++;
      return { status: 429, headers: {}, body: "secret diagnostic" };
    },
  });
  const result = await summarize(
    data(repository(), {
      ...repository(),
      id: 2,
      description: "A framework for building applications with a simple API.",
    }),
  );
  expect(calls).toBe(1);
  expect(
    result.newNotable.every((repo) => repo.summaryViStatus === "unavailable"),
  ).toBe(true);
  expect(result.newNotable[0]!.summaryVi).toContain("Chưa dịch được");
  expect(JSON.stringify(result)).not.toContain("secret diagnostic");
  const invalid = createVietnameseSummarizer({
    http: async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        responseStatus: 403,
        responseData: { translatedText: "MYMEMORY WARNING" },
      }),
    }),
  });
  expect(
    (await invalid(data(repository()))).newNotable[0]!.summaryViStatus,
  ).toBe("unavailable");
});
it("honors a pre-aborted signal without making network calls", async () => {
  let calls = 0;
  const summarize = createVietnameseSummarizer({
    http: async () => {
      calls++;
      return response();
    },
  });
  const result = await summarize(data(repository()), AbortSignal.abort());
  expect(calls).toBe(0);
  expect(result.newNotable[0]!.summaryViStatus).toBe("unavailable");
});

it("caps anonymous translation characters without sending the remaining descriptions", async () => {
  let characters = 0;
  let calls = 0;
  const summarize = createVietnameseSummarizer({
    http: async (url) => {
      calls++;
      characters += Array.from(new URL(url).searchParams.get("q")!).length;
      return response();
    },
  });
  const result = await summarize(
    data(
      ...Array.from({ length: 20 }, (_, index) => ({
        ...repository(
          "A tool for developers " +
            index +
            " " +
            "with useful features ".repeat(40),
        ),
        id: index + 1,
      })),
    ),
  );
  expect(characters).toBeLessThanOrEqual(3500);
  expect(calls).toBeLessThan(20);
  expect(
    result.newNotable.some((repo) => repo.summaryViStatus === "unavailable"),
  ).toBe(true);
});
