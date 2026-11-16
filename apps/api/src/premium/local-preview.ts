import { aiControlSchema, topicSummarySchema } from "@hub/contracts";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { checkUrl, ConnectorError, resolveTarget } from "../connectors/http.js";
import { geminiAdapter } from "./ai.js";
import { braveSearch, discoverySchema } from "./search.js";
import { fail, requirePremium } from "./store.js";

// Registered only by the loopback fixture server. Brave excerpts remain in
// memory for the request, and this route never uses the persistent search queue.
export async function registerLocalWebPreview(
  app: FastifyInstance,
  pool: Pool,
) {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const model = process.env.PREMIUM_PREVIEW_GEMINI_MODEL;
  const live = process.env.PREMIUM_BROWSER_LIVE === "1";
  if (live && (!braveKey || !geminiKey || !model))
    throw new Error(
      "Live Premium preview requires both keys and a Gemini model.",
    );
  app.get("/api/account/custom-web-preview", async () => {
    if (!live) return { live };
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM news_sources WHERE url LIKE 'https://rss.fixture.invalid/%' OR url='https://93.184.216.34/feed'",
    );
    return { live, sampleSourceIds: rows.map(({ id }) => id) };
  });
  if (!live || !braveKey || !geminiKey || !model) return;

  const search = braveSearch(braveKey);
  const summarize = geminiAdapter(geminiKey);
  const settings = await pool.query(
    "SELECT config FROM news_ai_control WHERE id=1",
  );
  const config = aiControlSchema.parse({
    ...settings.rows[0].config,
    model,
    timeoutMs: 10000,
  });
  let inProgress = false;
  let lastStarted = 0;
  app.post("/api/account/custom-web-preview", async (request, reply) => {
    const user =
      request.accountUser ?? fail(401, "AUTH_REQUIRED", "Vui lòng đăng nhập.");
    await requirePremium(pool, user.id);
    reply.header("Cache-Control", "no-store");
    const input = z
      .object({ description: z.string().trim().min(5).max(300) })
      .strict()
      .safeParse(request.body);
    if (!input.success)
      return fail(400, "INVALID_QUERY", "Nhập nhu cầu từ 5 đến 300 ký tự.");
    if (inProgress || Date.now() - lastStarted < 10000)
      fail(429, "PREVIEW_BUSY", "Chờ ít nhất 10 giây giữa hai lượt thử.");
    inProgress = true;
    lastStarted = Date.now();
    const signal = AbortSignal.timeout(24000);
    try {
      const result = await search
        .search(input.data.description, signal, true)
        .then((value) => discoverySchema.parse(value))
        .catch(() =>
          fail(
            502,
            "PREVIEW_SEARCH",
            "Brave chưa trả được kết quả. Kiểm tra khóa và hạn mức Search.",
          ),
        );
      const articles: { title: string; url: string; excerpt: string }[] = [];
      for (const candidate of result.candidates) {
        signal.throwIfAborted();
        try {
          const url = checkUrl(candidate.url);
          await resolveTarget(url);
          const href = url.toString();
          if (!articles.some((article) => article.url === href))
            articles.push({
              title: candidate.name,
              url: href,
              excerpt: candidate.evidence,
            });
        } catch {
          // Skip candidates without a public destination.
        }
      }
      if (!articles.length) return { summary: "", articles: [] };
      const sources = articles
        .map(
          (article, index) =>
            `[${index + 1}] ${article.title}\n${article.excerpt}`,
        )
        .join("\n\n");
      const links = articles.map(({ title, url }) => ({ title, url }));
      const prompt = `Nhu cầu: ${input.data.description}\n\nNguồn tham khảo:\n${sources}`;
      try {
        const answer = await summarize
          .run("summarize", prompt, config, signal)
          .catch(async (error: unknown) => {
            if (!(error instanceof ConnectorError) || error.code !== "HTTP_503")
              throw error;
            const retryDelay = error.retryAt
              ? Math.max(800, Date.parse(error.retryAt) - Date.now())
              : 800;
            if (retryDelay > 2000) throw error;
            await delay(retryDelay, undefined, { signal });
            return summarize.run("summarize", prompt, config, signal);
          });
        return {
          summary: topicSummarySchema.parse(answer.value).summary,
          articles: links,
        };
      } catch (error) {
        const code =
          error instanceof ConnectorError
            ? error.code
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? "INVALID_SUMMARY"
              : signal.aborted
                ? "TIMEOUT"
                : "UNKNOWN";
        console.warn("Gemini web preview summary unavailable", { code });
        const summaryNotice =
          code === "HTTP_429"
            ? "Gemini đang giới hạn lượt tổng hợp. Bạn vẫn có thể mở các nguồn bên dưới."
            : code === "HTTP_503"
              ? "Gemini đang bận. Bạn có thể mở các nguồn bên dưới hoặc thử tổng hợp lại sau."
              : "Đã tìm được nguồn, nhưng Gemini chưa tạo được bản tổng hợp. Bạn có thể đọc các nguồn bên dưới.";
        return { summary: "", summaryNotice, articles: links };
      }
    } finally {
      inProgress = false;
    }
  });
}
