import { useEffect, useMemo, useRef, useState } from "react";
import {
  foldVi,
  formatDateTime,
  goldBarItems,
  goldPricePerChi,
  normalizeUrl,
  priceLow30Text,
  safeExternalHref,
  type BookmarkKind,
  type Digest,
  type DigestSummary,
  type NotificationAttempt,
  type Repository,
  type RisingRepository,
  type RunAccepted,
  type SourceResult,
} from "@hub/contracts";
import { Icon } from "./Icons";
import { isSampleUrl } from "./sample-url";
import { apiRequest } from "./lib/api-client";
import { ExternalLink } from "./components/ExternalLink";
import { MorningBento } from "./features/digests/MorningBento";
import { QuickUtilitiesGrid } from "./features/digests/QuickTasksCard";
import { BookmarkButton } from "./features/digests/BookmarkButton";

const statusText: Record<string, string> = {
  success: "Thành công",
  partial: "Một phần",
  failed: "Thất bại",
  disabled: "Đã tắt",
  running: "Đang tạo",
  sending: "Đang gửi",
  unknown: "Chưa xác định",
};

function formatTime(value: string | null, timezone?: string): string {
  if (!value) return "Chưa hoàn tất";
  return formatDateTime(value, timezone);
}

function aqiTone(aqi: number | null | undefined): string {
  if (aqi == null) return "";
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  return "elevated";
}

function canonicalBookmarkKey(rawUrl: string): string {
  const safe = safeExternalHref(rawUrl);
  if (!safe) return rawUrl.trim();
  try {
    return normalizeUrl(safe);
  } catch {
    return safe;
  }
}

export type ToggleBookmarkPayload = {
  url: string;
  title: string;
  source: string;
  summary: string;
  kind: BookmarkKind;
  digestId: string | null;
};

function SourceHeader({
  title,
  result,
  showSource = true,
  calmMode = false,
  timezone,
}: {
  title: string;
  result: SourceResult<unknown>;
  showSource?: boolean;
  calmMode?: boolean;
  timezone?: string;
}) {
  const showStatusBadge = !calmMode || result.status !== "success";
  return (
    <>
      <div className="digest-section-heading">
        <h2>{title}</h2>
        {showStatusBadge && (
          <span className={"result-badge " + result.status}>
            {statusText[result.status] ?? result.status}
          </span>
        )}
      </div>
      {showSource && (!calmMode || result.status !== "success") && (
        <p className="muted">
          Lấy dữ liệu: {formatTime(result.fetchedAt, timezone)}
        </p>
      )}
      {result.status === "disabled" && (
        <p>Nguồn này đã tắt trong cấu hình lúc tạo bản tin.</p>
      )}
      {result.errors.length > 0 && (
        <ul className="source-errors">
          {result.errors.map((error, index) => (
            <li key={index}>
              {showSource && error.source ? error.source + ": " : ""}
              {error.message}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const isDisplayArticle = (item: { title: string; url: string }) =>
  !isSampleUrl(item.url) &&
  !/^\[(?:MÔ PHỎNG|DEMO FIXTURE)\]/i.test(item.title.trim());

function Repositories({
  items,
  rising = false,
  timezone,
  compact = false,
  digestId,
  bookmarkedUrls,
  onToggleBookmark,
}: {
  items: (Repository | RisingRepository)[];
  rising?: boolean;
  timezone?: string;
  compact?: boolean;
  digestId: string;
  bookmarkedUrls?: ReadonlyMap<string, string>;
  onToggleBookmark?: (payload: ToggleBookmarkPayload) => Promise<void>;
}) {
  return (
    <ul className={compact ? "digest-items compact-items" : "digest-items"}>
      {items.map((repo) => {
        const summary =
          repo.summaryVi ||
          (repo.description?.trim()
            ? "Chưa có bản dịch tiếng Việt cho mô tả này."
            : "Tác giả chưa cung cấp mô tả cho dự án này.");
        const isSaved = Boolean(
          bookmarkedUrls?.has(canonicalBookmarkKey(repo.url)),
        );
        return (
          <li key={repo.id}>
            <div className="digest-item-toprow">
              <ExternalLink href={repo.url}>{repo.name}</ExternalLink>
              {onToggleBookmark && (
                <BookmarkButton
                  saved={isSaved}
                  title={repo.name}
                  kind="github"
                  onToggle={() =>
                    void onToggleBookmark({
                      url: repo.url,
                      title: repo.name,
                      source: repo.language
                        ? `GitHub · ${repo.language}`
                        : "GitHub",
                      summary: summary.slice(0, 500),
                      kind: "github",
                      digestId,
                    })
                  }
                />
              )}
            </div>
            {!compact && <p>{summary}</p>}
            {!compact && repo.summaryViStatus === "translated" && (
              <small>Bản dịch tự động từ mô tả của tác giả</small>
            )}
            {!compact &&
              repo.description &&
              repo.description !== repo.summaryVi && (
                <details>
                  <summary>Mô tả gốc</summary>
                  <p lang="und">{repo.description}</p>
                </details>
              )}
            <small>
              {repo.language ?? "Chưa xác định ngôn ngữ"} ·{" "}
              {repo.stars.toLocaleString("vi-VN")} ★
              {rising && "starChange" in repo
                ? ` (${repo.starChange > 0 ? "+" : ""}${repo.starChange} ★ / ${repo.intervalHours.toFixed(1)}h)`
                : ` · Snapshot ${formatTime(repo.fetchedAt, timezone)}`}
            </small>
          </li>
        );
      })}
    </ul>
  );
}

function buildPlainDigestSummary(digest: Digest, timezone?: string): string {
  const lines: string[] = [];
  const effectiveTz = timezone ?? digest.settings.newsletter.timezone;
  lines.push(`Bản tin sáng — ${formatTime(digest.createdAt, effectiveTz)}`);
  const s = digest.sources;
  if (!s) return lines.join("\n");

  if (s.weather.data) {
    const w = s.weather.data;
    lines.push(
      `Thời tiết (${w.location}): ${w.minTemperature ?? "?"}–${w.maxTemperature ?? "?"}°C, ${w.description ?? ""}`,
    );
  }
  if (s.gold?.data) {
    const bar = goldBarItems(s.gold.data)[0];
    if (bar) {
      lines.push(
        `Vàng SJC: Mua ${goldPricePerChi(bar.buy, s.gold.data.unit).toLocaleString("vi-VN")} · Bán ${goldPricePerChi(bar.sell, s.gold.data.unit).toLocaleString("vi-VN")} đ/chỉ`,
      );
    }
  }
  if (s.usd?.data?.sell != null) {
    lines.push(`USD/VND bán ra: ${s.usd.data.sell.toLocaleString("vi-VN")} đ`);
  }
  if (s.fuel?.data?.items[0]) {
    const f = s.fuel.data.items[0];
    lines.push(`${f.name}: ${f.price.toLocaleString("vi-VN")} đ/lít`);
  }
  const rssItems = s.rss.data.items.filter(isDisplayArticle).slice(0, 5);
  if (rssItems.length > 0) {
    lines.push("\nTin nổi bật:");
    for (const item of rssItems) {
      lines.push(`- ${item.title} (${item.source})`);
    }
  }
  return lines.join("\n");
}

function DigestSkeleton() {
  return (
    <div className="digest-skeleton-stack" role="status" aria-label="Đang tải bản tin">
      <div className="skeleton-card skeleton-hero" />
      <div className="skeleton-bento">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
      <div className="skeleton-card skeleton-list" />
      <span className="sr-only">Đang tải bản tin…</span>
    </div>
  );
}

export default function DigestDashboard({
  hash,
  apiBase = "/api",
  accountId = "legacy",
  canCreate = true,
  timezone,
  bookmarkedUrls,
  onToggleBookmark,
  completedTaskIds,
  onToggleTask,
}: {
  hash: string;
  apiBase?: string;
  accountId?: string;
  canCreate?: boolean;
  timezone?: string;
  bookmarkedUrls?: ReadonlyMap<string, string>;
  onToggleBookmark?: (payload: ToggleBookmarkPayload) => Promise<void>;
  completedTaskIds?: ReadonlySet<string>;
  onToggleTask?: (taskId: string, done: boolean) => Promise<void>;
}) {
  const id = hash.startsWith("#/digests/")
    ? hash.slice("#/digests/".length)
    : null;
  const accountDashboard = apiBase === "/api/account";
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{
    items: DigestSummary[];
    hasMore: boolean;
  } | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [latest, setLatest] = useState<Digest | null>(null);
  const [filterText, setFilterText] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [comfortableFont, setComfortableFont] = useState(() => {
    try {
      return localStorage.getItem("hub-reader-comfortable") === "1";
    } catch {
      return false;
    }
  });
  const [compactMode, setCompactMode] = useState(() => {
    try {
      return localStorage.getItem("hub-reader-compact") === "1";
    } catch {
      return false;
    }
  });
  const searchInputRef = useRef<HTMLInputElement>(null);

  const effectiveTz =
    timezone ?? digest?.settings.newsletter.timezone ?? undefined;
  const latestSummary = !id && page === 1 ? list?.items[0] : undefined;
  const latestId = latestSummary?.id;
  const latestSources = latest?.id === latestId ? latest?.sources : undefined;
  const customSource = digest?.sources?.custom;
  const customItems = customSource?.data.items.filter(isDisplayArticle) ?? [];

  useEffect(() => {
    setFilterText("");
    setSourceFilter("all");
    setCopiedSummary(false);
  }, [id]);

  // Keyboard shortcut: "/" focuses search input inside a digest, Escape clears filter.
  useEffect(() => {
    if (!id) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (e.key === "/" && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape" && target === searchInputRef.current && filterText) {
        setFilterText("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [id, filterText]);

  // Mark digest as read when opened in authenticated account dashboard.
  useEffect(() => {
    if (!id || !accountDashboard || !digest || digest.status === "running") return;
    void apiRequest(`${apiBase}/digests/${encodeURIComponent(id)}/read`, {
      method: "POST",
      body: {},
      timeoutMs: 8000,
    }).catch(() => {});
    setList((curr) =>
      curr
        ? {
            ...curr,
            items: curr.items.map((item) =>
              item.id === id && !item.readAt
                ? { ...item, readAt: new Date().toISOString() }
                : item,
            ),
          }
        : curr,
    );
  }, [id, accountDashboard, apiBase, digest?.id, digest?.status]);

  useEffect(() => {
    if (!latestId) {
      setLatest(null);
      return;
    }
    const controller = new AbortController();
    void apiRequest<Digest>(
      apiBase + "/digests/" + encodeURIComponent(latestId),
      {
        signal: controller.signal,
        timeoutMs: 30000,
      },
    )
      .then((value) => {
        if (!controller.signal.aborted) setLatest(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLatest(null);
      });
    return () => controller.abort();
  }, [latestId, apiBase, reload]);

  const busy = useRef(false);
  const sendBusy = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setDigest(null);
    (id
      ? apiRequest<Digest>(apiBase + "/digests/" + encodeURIComponent(id), {
          signal: controller.signal,
          timeoutMs: 60000,
        }).then(setDigest)
      : apiRequest<{ items: DigestSummary[]; hasMore: boolean }>(
          apiBase + "/digests?page=" + page + "&pageSize=10",
          { signal: controller.signal, timeoutMs: 30000 },
        ).then(setList)
    )
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Không tải được bản tin.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, page, reload, apiBase]);

  // Background auto-refresh with in-flight guard while any digest is still running.
  const hasRunningItem = Boolean(
    digest?.status === "running" ||
      (!id && list?.items.some((item) => item.status === "running")),
  );
  useEffect(() => {
    if (!hasRunningItem) return;
    let inFlight = false;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      const task = id
        ? apiRequest<Digest>(apiBase + "/digests/" + encodeURIComponent(id), {
            timeoutMs: 15000,
            signal: controller.signal,
          }).then((next) => setDigest(next))
        : apiRequest<{ items: DigestSummary[]; hasMore: boolean }>(
            apiBase + "/digests?page=" + page + "&pageSize=10",
            { timeoutMs: 15000, signal: controller.signal },
          ).then((next) => setList(next));
      void task
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }, 3500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [hasRunningItem, id, page, apiBase]);

  async function create() {
    if (busy.current) return;
    busy.current = true;
    setCreating(true);
    setError("");
    setNotice("Đang gửi yêu cầu tạo bản tin…");
    let key = sessionStorage.getItem("hub-create-key-" + accountId);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem("hub-create-key-" + accountId, key);
    }
    try {
      const result = await apiRequest<RunAccepted>(apiBase + "/digests", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: {},
        timeoutMs: 60000,
      });
      sessionStorage.removeItem("hub-create-key-" + accountId);
      window.location.hash = "/runs/" + result.runId;
      setNotice("Đã gửi yêu cầu tạo bản tin.");
      setReload((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
      setNotice("Lần bấm tiếp theo dùng lại cùng yêu cầu để tránh tạo trùng.");
    } finally {
      busy.current = false;
      setCreating(false);
    }
  }

  async function send() {
    if (!digest || sendBusy.current) return;
    sendBusy.current = true;
    setSending(true);
    setError("");
    setNotice("");
    const storage = "hub-notification-key-" + digest.id;
    let key = sessionStorage.getItem(storage);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(storage, key);
    }
    try {
      const attempt = await apiRequest<NotificationAttempt>(
        apiBase + "/digests/" + encodeURIComponent(digest.id) + "/notifications",
        {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: {},
          timeoutMs: 60000,
        },
      );
      sessionStorage.removeItem(storage);
      setNotice(
        attempt.status === "success"
          ? "Đã gửi thông báo qua ntfy."
          : attempt.status === "sending"
            ? "Lần gửi này đang xử lý hoặc đã gián đoạn; không tự gửi lại."
            : attempt.status === "unknown"
              ? "Chưa xác định ntfy đã nhận hay chưa. Gửi lại có thể tạo thông báo trùng."
              : (attempt.error?.message ?? "Gửi thông báo thất bại."),
      );
      setReload((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
      setNotice(
        "Giữ cùng yêu cầu cho lần bấm tiếp theo. Khi ntfy đã nhận nhưng kết nối bị mất, không thể đảm bảo exactly-once.",
      );
    } finally {
      sendBusy.current = false;
      setSending(false);
    }
  }

  function toggleComfortableFont() {
    setComfortableFont((curr) => {
      const next = !curr;
      try {
        localStorage.setItem("hub-reader-comfortable", next ? "1" : "0");
      } catch {
        // Ignore storage restrictions.
      }
      return next;
    });
  }

  function toggleCompactMode() {
    setCompactMode((curr) => {
      const next = !curr;
      try {
        localStorage.setItem("hub-reader-compact", next ? "1" : "0");
      } catch {
        // Ignore storage restrictions.
      }
      return next;
    });
  }

  async function copySummary() {
    if (!digest) return;
    try {
      await navigator.clipboard.writeText(
        buildPlainDigestSummary(digest, effectiveTz),
      );
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2500);
    } catch {
      setNotice("Trình duyệt không cho phép sao chép tự động.");
    }
  }

  function jumpToSection(sectionId: string) {
    document
      .getElementById(sectionId)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const baseRssItems = useMemo(() => {
    const raw = digest?.sources?.rss.data.items ?? [];
    return accountDashboard ? raw.filter(isDisplayArticle) : raw;
  }, [digest?.sources?.rss.data.items, accountDashboard]);

  const rssSourcesList = useMemo(
    () => [...new Set(baseRssItems.map((item) => item.source))],
    [baseRssItems],
  );

  const needle = foldVi(filterText.trim());
  const filteredCustomItems = useMemo(
    () =>
      !needle
        ? customItems
        : customItems.filter((item) =>
            foldVi(`${item.title} ${item.source} ${item.reason}`).includes(
              needle,
            ),
          ),
    [customItems, needle],
  );
  const filteredRssItems = useMemo(() => {
    return baseRssItems.filter((item) => {
      if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
      if (!needle) return true;
      return foldVi(
        `${item.title} ${item.source} ${item.description}`,
      ).includes(needle);
    });
  }, [baseRssItems, sourceFilter, needle]);
  const filteredRisingRepos = useMemo(() => {
    const items = digest?.sources?.github.data.rising ?? [];
    if (!needle) return items;
    return items.filter((repo) =>
      foldVi(
        `${repo.name} ${repo.summaryVi ?? ""} ${repo.description ?? ""} ${repo.language ?? ""}`,
      ).includes(needle),
    );
  }, [digest?.sources?.github.data.rising, needle]);
  const filteredNotableRepos = useMemo(() => {
    const items = digest?.sources?.github.data.newNotable ?? [];
    if (!needle) return items;
    return items.filter((repo) =>
      foldVi(
        `${repo.name} ${repo.summaryVi ?? ""} ${repo.description ?? ""} ${repo.language ?? ""}`,
      ).includes(needle),
    );
  }, [digest?.sources?.github.data.newNotable, needle]);

  const readingStats = useMemo(() => {
    if (!digest?.sources) return null;
    const s = digest.sources;
    const articleCount = baseRssItems.length + customItems.length;
    const repoCount =
      s.github.data.rising.length + s.github.data.newNotable.length;
    const estMinutes = Math.max(
      1,
      Math.ceil((articleCount * 35 + repoCount * 30 + 80) / 200),
    );
    return { articleCount, repoCount, estMinutes };
  }, [digest?.sources, baseRssItems.length, customItems.length]);

  const jumpSections = useMemo(() => {
    if (!digest?.sources) return [];
    const s = digest.sources;
    const items: Array<{ id: string; label: string }> = [];
    if (
      [s.uv, s.holidays, s.tasks].some((x) => x && x.status !== "disabled")
    ) {
      items.push({ id: "section-utilities", label: "Tiện ích" });
    }
    if (customItems.length > 0) {
      items.push({ id: "section-custom", label: "Theo dõi riêng" });
    }
    if (s.rss.status !== "disabled") {
      items.push({ id: "section-rss", label: "Tin tức" });
    }
    if (s.gold && s.gold.status !== "disabled") {
      items.push({ id: "section-gold", label: "Vàng SJC" });
    }
    if (s.usd && s.usd.status !== "disabled") {
      items.push({ id: "section-usd", label: "USD/VND" });
    }
    if (s.fuel && s.fuel.status !== "disabled") {
      items.push({ id: "section-fuel", label: "Giá xăng" });
    }
    if (s.airQuality && s.airQuality.status !== "disabled") {
      items.push({ id: "section-air", label: "Không khí" });
    }
    if (s.weather.status !== "disabled") {
      items.push({ id: "section-weather", label: "Thời tiết" });
    }
    if (s.github.status !== "disabled") {
      items.push({ id: "section-github", label: "GitHub" });
    }
    return items;
  }, [digest?.sources, customItems.length]);

  const adjacentDigests = useMemo(() => {
    if (!id || !list?.items.length) return { newer: null, older: null };
    const idx = list.items.findIndex((item) => item.id === id);
    if (idx < 0) return { newer: null, older: null };
    return {
      newer: idx > 0 ? list.items[idx - 1]! : null,
      older: idx + 1 < list.items.length ? list.items[idx + 1]! : null,
    };
  }, [id, list?.items]);

  return (
    <div
      className={
        "digests-dashboard" +
        (comfortableFont ? " reader-comfortable" : "") +
        (compactMode ? " reader-compact" : "")
      }
    >
      <div className="page-heading">
        <div>
          {id && (
            <a className="back-link" href="#/digests">
              ‹ Tất cả bản tin
            </a>
          )}
          <h1>
            {id
              ? "Bản tin của bạn"
              : accountDashboard
                ? "Bản tin của tôi"
                : "Buổi sáng, gọn trong một bản tin."}
          </h1>
        </div>
        {id ? (
          <button
            type="button"
            className="primary-button"
            disabled={sending || !digest || digest.status === "running"}
            onClick={() => void send()}
          >
            <Icon name="send" size={17} />
            {sending ? "Đang gửi…" : "Gửi đến điện thoại"}
          </button>
        ) : (
          canCreate && (
            <button
              type="button"
              className="primary-button"
              disabled={creating}
              onClick={() => void create()}
            >
              {creating
                ? "Đang tạo…"
                : accountDashboard
                  ? "Tạo bản tin"
                  : "Tạo bản tin ngay"}
            </button>
          )
        )}
      </div>

      {notice && (
        <div className="status" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="status error" role="alert">
          {error}
        </div>
      )}
      {error && (
        <div className="digest-toolbar">
          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={() => setReload((v) => v + 1)}
          >
            Thử tải lại
          </button>
        </div>
      )}
      {loading && <DigestSkeleton />}

      {!id && !loading && list && (
        <>
          {latestSources && (
            <QuickUtilitiesGrid
              sources={latestSources}
              accountDashboard={accountDashboard}
              timezone={effectiveTz}
              completedTaskIds={completedTaskIds}
              onToggleTask={onToggleTask}
            />
          )}
          {latestSummary && (
            <section className="latest-brief" aria-label="Bản tin gần nhất">
              <div className="brief-heading">
                <div>
                  <span className="section-kicker">Bản tin gần nhất</span>
                  <h2>
                    {new Date(latestSummary.createdAt).toLocaleDateString(
                      "vi-VN",
                      {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        ...(effectiveTz ? { timeZone: effectiveTz } : {}),
                      },
                    )}
                  </h2>
                </div>
                <a
                  href={"#/digests/" + latestSummary.id}
                  className="text-link"
                >
                  Đọc bản tin đầy đủ <Icon name="arrow" size={17} />
                </a>
              </div>
              {latestSources ? (
                <div className="latest-bento-wrap">
                  <MorningBento sources={latestSources} />
                </div>
              ) : latestSummary.highlights ? (
                <div className="brief-overview">
                  <ul className="brief-topics">
                    {latestSummary.highlights.location &&
                      latestSummary.highlights.temperature && (
                        <li>
                          <strong>{latestSummary.highlights.location}</strong>{" "}
                          {latestSummary.highlights.temperature}
                        </li>
                      )}
                    {latestSummary.highlights.sjcSell != null && (
                      <li>
                        <strong>Vàng SJC</strong>{" "}
                        {latestSummary.highlights.sjcSell.toLocaleString("vi-VN")} đ/chỉ
                      </li>
                    )}
                    {latestSummary.highlights.articleCount > 0 && (
                      <li>
                        <strong>Tin tức</strong>{" "}
                        {latestSummary.highlights.articleCount} bài
                      </li>
                    )}
                  </ul>
                </div>
              ) : null}
            </section>
          )}
          <div className="section-heading">
            <h2>Lịch sử bản tin</h2>
            {!accountDashboard && (
              <a href="#/settings/rss" className="text-link">
                Quản lý nguồn
              </a>
            )}
          </div>
          {list.items.length === 0 ? (
            <div className="empty-state onboarding-empty-state">
              <span className="account-empty-icon">
                <Icon name="brief" size={32} />
              </span>
              <strong>Bắt đầu với những điều bạn quan tâm</strong>
              <p>
                {canCreate
                  ? "Bấm Tạo bản tin để tổng hợp ngay tin tức, thị trường và thời tiết đầu tiên."
                  : "Mở Tùy chọn bản tin để chọn nguồn tin và khu vực thời tiết bạn muốn nhận."}
              </p>
              <ol className="onboarding-steps">
                <li>1. Chọn chủ đề &amp; khu vực</li>
                <li>2. Đặt giờ nhận mỗi sáng</li>
                <li>3. Đọc gọn trong 2 phút</li>
              </ol>
              <a
                className="account-empty-action"
                href={accountDashboard ? "#/preferences" : "#/settings/rss"}
              >
                Chọn nội dung bản tin <Icon name="arrow" size={17} />
              </a>
            </div>
          ) : (
            <ul className="digest-history">
              {list.items.map((item) => {
                const h = item.highlights;
                const unread =
                  accountDashboard &&
                  item.status !== "running" &&
                  item.readAt === null;
                return (
                  <li key={item.id} className={unread ? "history-unread" : undefined}>
                    <a href={"#/digests/" + item.id}>
                      <div className="history-title-row">
                        {unread && (
                          <span
                            className="unread-dot"
                            title="Chưa đọc"
                            aria-label="Chưa đọc"
                          />
                        )}
                        <strong>
                          Bản tin {formatTime(item.createdAt, effectiveTz)}
                        </strong>
                      </div>
                      {h?.headline && (
                        <p className="history-headline-preview">{h.headline}</p>
                      )}
                      <small className="history-chips">
                        {h ? (
                          <>
                            {h.temperature && h.location && (
                              <span>
                                {h.location} {h.temperature}
                              </span>
                            )}
                            {h.sjcSell != null && (
                              <span>
                                SJC {h.sjcSell.toLocaleString("vi-VN")} đ
                              </span>
                            )}
                            {h.articleCount > 0 && (
                              <span>{h.articleCount} tin</span>
                            )}
                            {h.repoCount > 0 && (
                              <span>{h.repoCount} repo</span>
                            )}
                            {!h.temperature &&
                              h.sjcSell == null &&
                              h.articleCount === 0 &&
                              (item.completedAt
                                ? "Đã lưu đầy đủ nội dung"
                                : "Đang thu thập nội dung…")}
                          </>
                        ) : item.completedAt ? (
                          "Đã lưu đầy đủ nội dung"
                        ) : (
                          "Đang thu thập nội dung…"
                        )}
                      </small>
                    </a>
                    <span className={"result-badge " + item.status}>
                      {statusText[item.status] ?? item.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {(page > 1 || list.hasMore) && (
            <div className="pagination">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((v) => v - 1)}
              >
                Trang trước
              </button>
              <span>Trang {page}</span>
              <button
                type="button"
                disabled={!list.hasMore}
                onClick={() => setPage((v) => v + 1)}
              >
                Trang sau
              </button>
            </div>
          )}
        </>
      )}

      {digest && !loading && (
        <>
          <div className="digest-meta">
            <span className={"result-badge " + digest.status}>
              {statusText[digest.status] ?? digest.status}
            </span>
            <span>
              Tạo: {formatTime(digest.createdAt, effectiveTz)} · Hoàn tất:{" "}
              {formatTime(digest.completedAt, effectiveTz)}
            </span>
            {readingStats && (
              <span className="reading-stats-pill">
                ~{readingStats.estMinutes} phút đọc ·{" "}
                {readingStats.articleCount} tin
                {readingStats.repoCount > 0
                  ? ` · ${readingStats.repoCount} repo`
                  : ""}
              </span>
            )}
            <details>
              <summary>Thông tin bản tin</summary>
              <small>
                ID: {digest.id}
                <br />
                Múi giờ: {digest.settings.newsletter.timezone}
              </small>
            </details>
          </div>

          {digest.sources && (
            <div className="digest-reader-toolbar">
              <div className="digest-reader-search">
                <Icon name="search" size={16} />
                <input
                  ref={searchInputRef}
                  type="search"
                  placeholder="Tìm bài viết & dự án (nhấn / để tìm, gõ có hoặc không dấu)…"
                  aria-label="Lọc nhanh bài viết trong bản tin"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                />
              </div>
              <div className="digest-reader-actions">
                <button
                  type="button"
                  aria-pressed={compactMode}
                  onClick={toggleCompactMode}
                  title="Chuyển giữa chế độ đọc gọn tiêu đề và chế độ tạp chí"
                >
                  <Icon name={compactMode ? "list" : "grid"} size={15} />
                  {compactMode ? "Đọc gọn" : "Tạp chí"}
                </button>
                <button
                  type="button"
                  aria-pressed={comfortableFont}
                  onClick={toggleComfortableFont}
                >
                  Cỡ chữ lớn
                </button>
                <button type="button" onClick={() => void copySummary()}>
                  <Icon name={copiedSummary ? "check" : "copy"} size={15} />
                  {copiedSummary ? "Đã chép tóm tắt" : "Sao chép tóm tắt"}
                </button>
              </div>
            </div>
          )}

          {jumpSections.length > 2 && (
            <nav
              className="section-jump-pills"
              aria-label="Chuyển nhanh tới mục"
            >
              {jumpSections.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => jumpToSection(sec.id)}
                >
                  {sec.label}
                </button>
              ))}
            </nav>
          )}

          {digest.status === "running" && (
            <div className="notice" role="status">
              Bản tin đang được tổng hợp và sẽ tự động cập nhật sau vài giây…
            </div>
          )}

          {digest.sources && (
            <>
              <MorningBento
                sources={digest.sources}
                onJump={jumpToSection}
              />

              <QuickUtilitiesGrid
                sources={digest.sources}
                accountDashboard={accountDashboard}
                timezone={effectiveTz}
                completedTaskIds={completedTaskIds}
                onToggleTask={onToggleTask}
              />

              {customSource && customItems.length > 0 && (
                <section
                  id="section-custom"
                  className="digest-section custom-digest-section"
                >
                  <SourceHeader
                    title="Theo dõi tùy chỉnh"
                    result={customSource}
                    showSource={false}
                    calmMode={accountDashboard}
                    timezone={effectiveTz}
                  />
                  {filteredCustomItems.length > 0 ? (
                    <ul
                      className={
                        compactMode
                          ? "digest-items compact-items"
                          : "digest-items"
                      }
                    >
                      {filteredCustomItems.map((item) => {
                        const isSaved = Boolean(
                          bookmarkedUrls?.has(canonicalBookmarkKey(item.url)),
                        );
                        return (
                          <li key={item.id}>
                            <div className="digest-item-toprow">
                              <ExternalLink href={item.url}>
                                {item.title}
                              </ExternalLink>
                              {onToggleBookmark && (
                                <BookmarkButton
                                  saved={isSaved}
                                  title={item.title}
                                  kind="custom"
                                  onToggle={() =>
                                    void onToggleBookmark({
                                      url: item.url,
                                      title: item.title,
                                      source: item.source,
                                      summary: item.reason,
                                      kind: "custom",
                                      digestId: digest.id,
                                    })
                                  }
                                />
                              )}
                            </div>
                            <small>
                              {item.source} ·{" "}
                              {formatTime(item.publishedAt, effectiveTz)}
                            </small>
                            {!compactMode && <p>{item.reason}</p>}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="muted">
                      Không có tin theo dõi khớp từ khóa lọc.
                    </p>
                  )}
                  <small>
                    Cập nhật {formatTime(customSource.fetchedAt, effectiveTz)}.
                    Kiểm tra thông tin tại nguồn.
                  </small>
                </section>
              )}

              <section id="section-rss" className="digest-section">
                <SourceHeader
                  title="Tin tức chọn lọc"
                  result={digest.sources.rss}
                  calmMode={accountDashboard}
                  timezone={effectiveTz}
                />
                {rssSourcesList.length > 1 && (
                  <div
                    className="source-filter-pills"
                    role="group"
                    aria-label="Lọc theo đầu báo"
                  >
                    <button
                      type="button"
                      aria-pressed={sourceFilter === "all"}
                      className={sourceFilter === "all" ? "pill-active" : undefined}
                      onClick={() => setSourceFilter("all")}
                    >
                      Tất cả ({baseRssItems.length})
                    </button>
                    {rssSourcesList.map((src) => (
                      <button
                        key={src}
                        type="button"
                        aria-pressed={sourceFilter === src}
                        className={sourceFilter === src ? "pill-active" : undefined}
                        onClick={() => setSourceFilter(src)}
                      >
                        {src}
                      </button>
                    ))}
                  </div>
                )}
                {filteredRssItems.length > 0 ? (
                  <ul
                    className={
                      compactMode
                        ? "digest-items compact-items"
                        : "digest-items"
                    }
                  >
                    {filteredRssItems.map((item) => {
                      const isSaved = Boolean(
                        bookmarkedUrls?.has(canonicalBookmarkKey(item.url)),
                      );
                      return (
                        <li key={item.url}>
                          <div className="digest-item-toprow">
                            <ExternalLink href={item.url}>
                              {item.title}
                            </ExternalLink>
                            {onToggleBookmark && (
                              <BookmarkButton
                                saved={isSaved}
                                title={item.title}
                                kind="rss"
                                onToggle={() =>
                                  void onToggleBookmark({
                                    url: item.url,
                                    title: item.title,
                                    source: item.source,
                                    summary: item.description,
                                    kind: "rss",
                                    digestId: digest.id,
                                  })
                                }
                              />
                            )}
                          </div>
                          <small>
                            {item.source} ·{" "}
                            {formatTime(item.publishedAt, effectiveTz)}
                          </small>
                          {!compactMode && <p>{item.description}</p>}
                        </li>
                      );
                    })}
                  </ul>
                ) : baseRssItems.length > 0 && (needle || sourceFilter !== "all") ? (
                  <p className="muted">
                    Không có bài viết nào khớp bộ lọc hiện tại.
                  </p>
                ) : (
                  digest.sources.rss.status !== "disabled" && (
                    <p>Không có bài hợp lệ trong 24 giờ gần nhất.</p>
                  )
                )}
                <details>
                  <summary>Chi tiết thu thập nguồn tin</summary>
                  <small>
                    Đọc thành công {digest.sources.rss.data.feedsSucceeded}/
                    {digest.sources.rss.data.feedsTotal} nguồn RSS
                    {digest.sources.rss.data.skippedInvalidDate > 0
                      ? ` · Bỏ qua ${digest.sources.rss.data.skippedInvalidDate} mục thiếu ngày`
                      : ""}
                    .
                  </small>
                </details>
              </section>

              {digest.sources.gold &&
                digest.sources.gold.status !== "disabled" && (
                  <section id="section-gold" className="digest-section">
                    <SourceHeader
                      title="Vàng miếng SJC"
                      result={digest.sources.gold}
                      showSource={false}
                      calmMode={accountDashboard}
                      timezone={effectiveTz}
                    />
                    {digest.sources.gold.data &&
                    goldBarItems(digest.sources.gold.data).length ? (
                      <>
                        <p>
                          {digest.sources.gold.data.region} · Đơn vị: đồng/chỉ
                        </p>
                        <ul className="digest-items">
                          {goldBarItems(digest.sources.gold.data).map(
                            (item) => (
                              <li key={item.code}>
                                <strong>Vàng miếng SJC</strong>
                                <div className="weather-facts">
                                  <p>
                                    Mua vào
                                    <strong>
                                      {goldPricePerChi(
                                        item.buy,
                                        digest.sources!.gold!.data!.unit,
                                      ).toLocaleString("vi-VN")}
                                    </strong>
                                  </p>
                                  <p>
                                    Bán ra
                                    <strong>
                                      {goldPricePerChi(
                                        item.sell,
                                        digest.sources!.gold!.data!.unit,
                                      ).toLocaleString("vi-VN")}
                                    </strong>
                                  </p>
                                </div>
                                <p>{priceLow30Text(item.low30, false)}</p>
                              </li>
                            ),
                          )}
                        </ul>
                        {digest.sources.gold.data.previousDay && (
                          <p className="muted">Đang hiển thị giá chốt phiên ngày trước.</p>
                        )}
                      </>
                    ) : (
                      <p>Chưa lấy được bảng giá vàng SJC đã xác minh cho phiên này.</p>
                    )}
                  </section>
                )}

              {digest.sources.usd &&
                digest.sources.usd.status !== "disabled" && (
                  <section id="section-usd" className="digest-section">
                    <SourceHeader
                      title="Tỷ giá USD/VND"
                      result={digest.sources.usd}
                      showSource={false}
                      calmMode={accountDashboard}
                      timezone={effectiveTz}
                    />
                    {digest.sources.usd.data ? (
                      <>
                        <p>
                          Đơn vị: đồng cho 1 USD (niêm yết Vietcombank).
                        </p>
                        <div className="weather-facts">
                          <p>
                            Ngân hàng mua tiền mặt
                            <strong>
                              {digest.sources.usd.data.buyCash?.toLocaleString(
                                "vi-VN",
                              ) ?? "Chưa có"}
                            </strong>
                          </p>
                          <p>
                            Ngân hàng mua chuyển khoản
                            <strong>
                              {digest.sources.usd.data.buyTransfer?.toLocaleString(
                                "vi-VN",
                              ) ?? "Chưa có"}
                            </strong>
                          </p>
                          <p>
                            Ngân hàng bán
                            <strong>
                              {digest.sources.usd.data.sell?.toLocaleString(
                                "vi-VN",
                              ) ?? "Chưa có"}
                            </strong>
                            <span>
                              {priceLow30Text(
                                digest.sources.usd.data.low30,
                                false,
                              )}
                            </span>
                          </p>
                        </div>
                        {digest.sources.usd.data.previousDay && (
                          <p className="muted">Tỷ giá ngày làm việc liền trước.</p>
                        )}
                      </>
                    ) : (
                      <p>Chưa lấy được tỷ giá đã xác minh.</p>
                    )}
                  </section>
                )}

              {digest.sources.fuel &&
                digest.sources.fuel.status !== "disabled" && (
                  <section id="section-fuel" className="digest-section">
                    <SourceHeader
                      title="Giá xăng RON 95"
                      result={digest.sources.fuel}
                      calmMode={accountDashboard}
                      timezone={effectiveTz}
                    />
                    {digest.sources.fuel.data ? (
                      <>
                        <p>
                          {digest.sources.fuel.data.region} · Đơn vị: đồng/lít
                        </p>
                        <ul className="digest-items">
                          {digest.sources.fuel.data.items.map((item) => (
                            <li key={item.code}>
                              <strong>{item.name}</strong>
                              <p>{item.price.toLocaleString("vi-VN")} đ/lít</p>
                              <small>
                                {item.change === null
                                  ? "Chưa có giá trước để so sánh"
                                  : item.change === 0
                                    ? "Không đổi so với bản tin trước"
                                    : `${item.change > 0 ? "Tăng" : "Giảm"} ${Math.abs(item.change).toLocaleString("vi-VN")} đ/lít so với bản tin trước`}
                              </small>
                            </li>
                          ))}
                        </ul>
                        <p>
                          Hiệu lực từ:{" "}
                          {formatTime(
                            digest.sources.fuel.data.effectiveAt,
                            effectiveTz,
                          )}
                        </p>
                        <ExternalLink
                          href={digest.sources.fuel.data.sourceUrl}
                          className="text-link"
                        >
                          Nguồn: Petrolimex
                        </ExternalLink>
                      </>
                    ) : (
                      <p>
                        Chưa lấy được bảng giá đã xác minh. Các nội dung khác
                        vẫn có trong bản tin.
                      </p>
                    )}
                  </section>
                )}

              {digest.sources.airQuality &&
                digest.sources.airQuality.status !== "disabled" && (
                  <section id="section-air" className="digest-section">
                    <SourceHeader
                      title={
                        "Chất lượng không khí " +
                        (digest.sources.airQuality.data?.location ??
                          digest.settings.airQuality?.location ??
                          "Hà Nội")
                      }
                      result={digest.sources.airQuality}
                      calmMode={accountDashboard}
                      timezone={effectiveTz}
                    />
                    {digest.sources.airQuality.data ? (
                      <>
                        <div className="weather-facts">
                          <p>
                            AQI theo thang Mỹ
                            <strong
                              className={
                                "aqi-value " +
                                aqiTone(digest.sources.airQuality.data.usAqi)
                              }
                            >
                              {digest.sources.airQuality.data.usAqi ??
                                "Chưa có"}
                            </strong>
                          </p>
                          <p>
                            Mức đánh giá
                            <strong>
                              {digest.sources.airQuality.data.category ??
                                "Chưa phân loại"}
                            </strong>
                          </p>
                          <p>
                            PM2.5
                            <strong>
                              {digest.sources.airQuality.data.pm25?.toLocaleString(
                                "vi-VN",
                                { maximumFractionDigits: 1 },
                              ) ?? "Chưa có"}
                              {digest.sources.airQuality.data.pm25 !== null
                                ? " µg/m³"
                                : ""}
                            </strong>
                          </p>
                        </div>
                        <p className="attribution">
                          <ExternalLink
                            href={digest.sources.airQuality.data.sourceUrl}
                          >
                            {digest.sources.airQuality.data.attribution}
                          </ExternalLink>
                        </p>
                      </>
                    ) : (
                      <p>
                        Chưa lấy được dữ liệu mới. Các nội dung khác vẫn có
                        trong bản tin.
                      </p>
                    )}
                  </section>
                )}

              <section id="section-weather" className="digest-section">
                <SourceHeader
                  title="Thời tiết chi tiết"
                  result={digest.sources.weather}
                  calmMode={accountDashboard}
                  timezone={effectiveTz}
                />
                {digest.sources.weather.data ? (
                  <>
                    <h3>
                      {digest.sources.weather.data.location} ·{" "}
                      {digest.sources.weather.data.date}
                    </h3>
                    <p>{digest.sources.weather.data.description}</p>
                    <div className="weather-facts">
                      <p>
                        Thấp nhất
                        <strong>
                          {digest.sources.weather.data.minTemperature ??
                            "Chưa có"}
                          {digest.sources.weather.data.minTemperature !== null
                            ? " °C"
                            : ""}
                        </strong>
                      </p>
                      <p>
                        Cao nhất
                        <strong>
                          {digest.sources.weather.data.maxTemperature ??
                            "Chưa có"}
                          {digest.sources.weather.data.maxTemperature !== null
                            ? " °C"
                            : ""}
                        </strong>
                      </p>
                      <p>
                        Xác suất mưa
                        <strong>
                          {digest.sources.weather.data.rainProbability ??
                            "Chưa có"}
                          {digest.sources.weather.data.rainProbability !== null
                            ? "%"
                            : ""}
                        </strong>
                      </p>
                    </div>
                    {digest.sources.weather.data.umbrella && (
                      <p className="umbrella">Nên mang ô hôm nay.</p>
                    )}
                    <p className="attribution">
                      <ExternalLink
                        href={digest.sources.weather.data.attribution.url}
                      >
                        {digest.sources.weather.data.attribution.name}
                      </ExternalLink>{" "}
                      <ExternalLink
                        href={
                          digest.sources.weather.data.attribution.licenseUrl
                        }
                      >
                        Giấy phép
                      </ExternalLink>
                    </p>
                  </>
                ) : (
                  digest.sources.weather.status !== "disabled" && (
                    <p>Chưa có dữ liệu thời tiết.</p>
                  )
                )}
              </section>

              <section id="section-github" className="digest-section">
                <SourceHeader
                  title="GitHub"
                  result={digest.sources.github}
                  calmMode={accountDashboard}
                  timezone={effectiveTz}
                />
                {digest.sources.github.status !== "disabled" && (
                  <>
                    {filteredRisingRepos.length ? (
                      <>
                        <h3>Đang được quan tâm</h3>
                        <Repositories
                          items={filteredRisingRepos}
                          rising
                          timezone={effectiveTz}
                          compact={compactMode}
                          digestId={digest.id}
                          bookmarkedUrls={bookmarkedUrls}
                          onToggleBookmark={onToggleBookmark}
                        />
                      </>
                    ) : null}
                    {filteredNotableRepos.length ? (
                      <>
                        <h3>Dự án mới đáng chú ý</h3>
                        <Repositories
                          items={filteredNotableRepos}
                          timezone={effectiveTz}
                          compact={compactMode}
                          digestId={digest.id}
                          bookmarkedUrls={bookmarkedUrls}
                          onToggleBookmark={onToggleBookmark}
                        />
                      </>
                    ) : needle ? (
                      <p className="muted">
                        Không có dự án GitHub nào khớp từ khóa lọc.
                      </p>
                    ) : (
                      <p>
                        Không có dự án mới phù hợp chưa có baseline trong tập
                        kết quả.
                      </p>
                    )}
                    <details>
                      <summary>Phạm vi theo dõi</summary>
                      <small>
                        {digest.sources.github.data.candidates} ứng viên;{" "}
                        {digest.sources.github.data.withoutBaseline} chưa có
                        baseline hợp lệ. Danh sách trong tập theo dõi, không phải
                        bảng GitHub Trending chính thức.
                      </small>
                    </details>
                  </>
                )}
              </section>
            </>
          )}

          {(adjacentDigests.newer || adjacentDigests.older) && (
            <nav className="digest-adjacent-nav" aria-label="Điều hướng giữa các bản tin">
              {adjacentDigests.newer ? (
                <a href={"#/digests/" + adjacentDigests.newer.id}>
                  <span>‹ Bản tin mới hơn</span>
                  <strong>
                    {formatTime(adjacentDigests.newer.createdAt, effectiveTz)}
                  </strong>
                </a>
              ) : (
                <span />
              )}
              {adjacentDigests.older ? (
                <a
                  href={"#/digests/" + adjacentDigests.older.id}
                  className="adjacent-older"
                >
                  <span>Bản tin trước đó ›</span>
                  <strong>
                    {formatTime(adjacentDigests.older.createdAt, effectiveTz)}
                  </strong>
                </a>
              ) : (
                <span />
              )}
            </nav>
          )}

          <details className="delivery-details">
            <summary>
              Lịch sử gửi đến điện thoại ({digest.notifications.length})
            </summary>
            {digest.notifications.length === 0 ? (
              <p>Chưa có lần gửi nào.</p>
            ) : (
              <ul className="notification-history">
                {digest.notifications.map((attempt) => (
                  <li key={attempt.id}>
                    <strong>
                      {statusText[attempt.status] ?? attempt.status}
                    </strong>{" "}
                    · {formatTime(attempt.createdAt, effectiveTz)}
                    {attempt.error && <p>{attempt.error.message}</p>}
                    {["sending", "unknown"].includes(attempt.status) && (
                      <p>
                        Kết quả có thể chưa xác định. Một lần gửi mới có thể tạo
                        thông báo trùng.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </>
      )}
    </div>
  );
}
