import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  watchConditionsSchema,
  watchSchema,
  type WatchInput,
  type AiControl,
} from "@hub/contracts";
import { requestSignal } from "./request-signal";
import { Icon } from "./Icons";
import { isSampleUrl } from "./sample-url";
import paymentQr from "./assets/premium-payment-qr.png";
import "./premium.css";
type Plan = {
  id: string;
  premium: boolean;
  expires_at: string | null;
  active_watches: number;
  discovery_month: number;
  ai_calls_month: number;
  min_interval_minutes: number;
};
type Subscription = {
  plan: Plan;
  counts: { active: string; total: string };
  usage: { kind: string; status: string; calls: number }[];
  aiEnabled: boolean;
  searchEnabled: boolean;
  includeDigest: boolean;
  signup: {
    status: "pending" | "approved" | "declined";
    requested_at: string;
    review_note: string | null;
  } | null;
  premiumOffer: {
    active_watches: number;
    discovery_month: number;
    ai_calls_month: number;
  };
};
type Source = {
  id: string;
  name: string;
  url: string;
  status?: string;
  last_error?: string | null;
  catalog_rank?: number | null;
};
function SourceChoices({
  sources,
  selected,
  onChange,
}: {
  sources: Source[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="custom-source-choices">
      {sources.map((source) => (
        <label className="account-check" key={source.id}>
          <input
            type="checkbox"
            checked={selected.includes(source.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, source.id]
                  : selected.filter((id) => id !== source.id),
              )
            }
          />
          {source.name}
        </label>
      ))}
    </div>
  );
}
type Watch = {
  id: string;
  name: string;
  description: string;
  conditions: WatchInput["conditions"];
  source_ids: string[];
  interval_minutes: number;
  lookback_days: number;
  enabled: boolean;
  version: number;
  last_run_at: string | null;
  last_error: string | null;
};
type Match = {
  watch_id: string;
  article_id: string;
  watch_name: string;
  title: string;
  url: string;
  description: string;
  reason: string;
  source_name: string;
  published_at: string;
  fetched_at: string;
  saved: boolean;
  hidden: boolean;
};
const frequency = (minutes: number) =>
  minutes % 1440 === 0
    ? `Mỗi ${minutes / 1440} ngày`
    : minutes % 60 === 0
      ? `Mỗi ${minutes / 60} giờ`
      : `Mỗi ${minutes} phút`;
const when = (s: string | null) =>
  s ? new Date(s).toLocaleString("vi-VN") : "Chưa có";
const usualIntervals = [60, 120, 360, 720, 1440, 2880, 10080];
async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
  key?: string,
): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : method,
    credentials: "same-origin",
    signal: requestSignal(30000),
    ...(body !== undefined
      ? {
          headers: {
            "Content-Type": "application/json",
            ...(key ? { "Idempotency-Key": key } : {}),
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Chưa tải được dữ liệu.");
  return data;
}
const empty = (interval = 360): WatchInput => ({
  name: "",
  description: "",
  conditions: watchConditionsSchema.parse({}),
  sourceIds: [],
  intervalMinutes: interval,
  enabled: true,
  lookbackDays: 1,
  confirmed: true,
});
export default function PremiumPortal({
  admin = false,
  email,
}: {
  admin?: boolean;
  email: string;
}) {
  return admin ? <PremiumAdmin /> : <WatchPortal email={email} />;
}

function WatchPortal({ email }: { email: string }) {
  const editorTitle = useRef<HTMLHeadingElement>(null);
  const sourceDialog = useRef<HTMLDialogElement>(null);
  const [sourceSent, setSourceSent] = useState(false);
  const [view, setView] = useState<"watches" | "results" | "plan">("watches");
  const [data, setData] = useState<Subscription | null>(null),
    [watches, setWatches] = useState<Watch[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [results, setResults] = useState<Match[]>([]);
  const [livePreview, setLivePreview] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState(1);
  const [draft, setDraft] = useState<WatchInput | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [preview, setPreview] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [manualInterval, setManualInterval] = useState(false);
  const [job, setJob] = useState<string | null>(null),
    [jobStatus, setJobStatus] = useState(""),
    [interpretKey, setInterpretKey] = useState<string | null>(null);
  const editingWatch = draft !== null && view === "watches";
  useEffect(() => {
    if (editingWatch) editorTitle.current?.focus();
  }, [editingWatch, preview]);
  async function load() {
    const [p, w, s, r, previewMode] = await Promise.all([
      api<Subscription>("/api/account/plan"),
      api<{ watches: Watch[] }>("/api/account/watches"),
      api<{ sources: Source[] }>("/api/account/custom-sources"),
      api<{ results: Match[] }>("/api/account/custom-results?page=" + page),
      import.meta.env.DEV
        ? api<{ live: boolean; sampleSourceIds?: string[] }>(
            "/api/account/custom-web-preview",
          ).catch(() => ({ live: false, sampleSourceIds: [] }))
        : { live: false, sampleSourceIds: [] },
    ]);
    const sampleIds = new Set([
      ...(previewMode.sampleSourceIds ?? []),
      ...s.sources
        .filter((source) => isSampleUrl(source.url))
        .map((source) => source.id),
    ]);
    const visibleWatches = previewMode.live
      ? w.watches
          .filter(
            (watch) =>
              !watch.source_ids.length ||
              watch.source_ids.some((id) => !sampleIds.has(id)),
          )
          .map((watch) => ({
            ...watch,
            source_ids: watch.source_ids.filter((id) => !sampleIds.has(id)),
          }))
      : w.watches;
    const visibleWatchIds = new Set(visibleWatches.map((watch) => watch.id));
    setData(p);
    setLivePreview(previewMode.live);
    setWatches(visibleWatches);
    setSources(
      previewMode.live
        ? s.sources.filter((source) => !sampleIds.has(source.id))
        : s.sources,
    );
    setResults(
      previewMode.live
        ? r.results.filter(
            (result) =>
              visibleWatchIds.has(result.watch_id) && !isSampleUrl(result.url),
          )
        : r.results,
    );
    setHasNextPage(r.results.length >= 50);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    void load()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page]);
  async function action(work?: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work?.();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function checkJob() {
    if (!job) return;
    const r = await api<{
      status: string;
      result: unknown;
      error?: { message: string };
    }>("/api/account/custom-jobs/" + job);
    setJobStatus(r.status);
    if (r.status === "completed") {
      const conditions = watchConditionsSchema.parse(r.result);
      setDraft((d) => (d ? { ...d, conditions } : d));
      setPreview(true);
      setConfirmed(false);
      setJob(null);
      setInterpretKey(null);
      setNotice(
        "Đã đề xuất điều kiện. Hãy kiểm tra và xác nhận trước khi lưu.",
      );
    } else if (r.status === "failed") {
      setJob(null);
      setInterpretKey(null);
      throw new Error(
        r.error?.message ?? "Không xử lý được; hãy nhập điều kiện thủ công.",
      );
    }
  }
  if (loading && !data)
    return (
      <section className="account-card" role="status">
        Đang tải gói và nhu cầu…
      </section>
    );
  if (!data)
    return (
      <section className="account-card">
        <p role="alert">{error}</p>
        <button onClick={() => void action(load)}>Thử lại</button>
      </section>
    );
  const plan = data.plan;
  const starterSources = sources.filter(
    (source) => source.catalog_rank != null,
  );
  const otherSources = sources.filter((source) => source.catalog_rank == null);
  const intervalChoices = [
    ...new Set([plan.min_interval_minutes, ...usualIntervals]),
  ]
    .filter((minutes) => minutes >= plan.min_interval_minutes)
    .sort((a, b) => a - b);
  const customInterval =
    draft &&
    (manualInterval || !intervalChoices.includes(draft.intervalMinutes));
  const assistantEnabled = data.aiEnabled && !livePreview;
  const discoveryEnabled = data.searchEnabled && !livePreview;
  const edit = (w?: Watch) => {
    setView("watches");
    setNotice("");
    setSourceSent(false);
    setError("");
    setEditing(w?.id ?? null);
    setManualInterval(false);
    setDraft(
      w
        ? {
            name: w.name,
            description: w.description,
            conditions: w.conditions,
            sourceIds: w.source_ids,
            intervalMinutes: w.interval_minutes,
            lookbackDays: w.lookback_days,
            enabled: w.enabled,
            confirmed: true,
          }
        : empty(plan.min_interval_minutes),
    );
    setPreview(false);
    setConfirmed(false);
    setJob(null);
    setInterpretKey(null);
  };
  function change(patch: Partial<WatchInput>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setPreview(false);
    setConfirmed(false);
    if (patch.description !== undefined) setInterpretKey(null);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const parsed = watchSchema.safeParse(draft);
    setError("");
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setError(
        fields.name
          ? "Hãy đặt tên cho theo dõi."
          : fields.sourceIds
            ? draft.sourceIds.length
              ? "Chọn tối đa 8 trang để lấy tin."
              : "Hãy chọn ít nhất một trang để lấy tin."
            : fields.conditions
              ? "Mỗi bộ lọc nhận tối đa 20 từ khóa, mỗi từ khóa tối đa 100 ký tự."
              : "Kiểm tra tên, lịch và số ngày tìm lại.",
      );
      return;
    }
    if (draft.intervalMinutes < plan.min_interval_minutes) {
      setError(
        `Tần suất tối thiểu là ${frequency(plan.min_interval_minutes).toLowerCase()}. Chọn lại thời gian kiểm tra.`,
      );
      return;
    }
    if (
      draft.sourceIds.some((id) => !sources.some((source) => source.id === id))
    ) {
      setError(
        "Một trang không còn lấy tin được. Hãy chọn trang khác trong danh sách.",
      );
      setDraft({
        ...draft,
        sourceIds: draft.sourceIds.filter((id) =>
          sources.some((source) => source.id === id),
        ),
      });
      setPreview(false);
      setConfirmed(false);
      return;
    }
    if (!preview) {
      setPreview(true);
      return;
    }
    if (!confirmed) return;
    await action(async () => {
      await api(
        editing ? "/api/account/watches/" + editing : "/api/account/watches",
        parsed.data,
        editing ? "PUT" : "POST",
      );
      setDraft(null);
      setNotice("Đã lưu theo dõi.");
    });
  }
  return (
    <section className="custom-portal custom-member">
      <header className="custom-intro">
        <h1>Gói &amp; theo dõi</h1>
        {view !== "plan" && (
          <span className="custom-plan-badge">
            {plan.premium && <Icon name="sparkle" size={14} />}
            {plan.premium ? "Premium thử nghiệm" : "Free"}
          </span>
        )}
      </header>
      <nav className="custom-tabs" aria-label="Khu vực theo dõi">
        {(
          [
            ["watches", "Theo dõi của tôi", "activity"],
            ["results", "Kết quả", "brief"],
            ["plan", "Gói của tôi", "sparkle"],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => setView(key)}
          >
            <Icon name={icon} size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <section
        className="account-card custom-plan-details"
        hidden={view !== "plan"}
      >
        <div className="custom-plan-heading">
          <span className="custom-plan-symbol">
            <Icon name={plan.premium ? "sparkle" : "user"} size={24} />
          </span>
          <div>
            <h2>{plan.premium ? "Premium thử nghiệm" : "Free"}</h2>
            {plan.premium && <p>Hết hạn {when(plan.expires_at)}</p>}
          </div>
        </div>
        {plan.expires_at && !plan.premium && (
          <p role="status">Premium đã hết hạn. Theo dõi đang tạm dừng.</p>
        )}
        {!plan.premium && (
          <PremiumSignup
            signup={data.signup}
            offer={data.premiumOffer}
            email={email}
            busy={busy}
            onAction={action}
          />
        )}
        {plan.premium && (
          <>
            <dl className="custom-plan-metrics">
              <div>
                <dt>Theo dõi đang bật</dt>
                <dd>
                  {livePreview
                    ? watches.filter((watch) => watch.enabled).length
                    : data.counts.active}
                  <span>/{plan.active_watches}</span>
                </dd>
              </div>
              {!livePreview && (
                <div>
                  <dt>Lượt AI tháng này</dt>
                  <dd>
                    {data.usage
                      .filter((u) => u.kind !== "discover")
                      .reduce((n, u) => n + u.calls, 0)}
                    <span>/{plan.ai_calls_month}</span>
                  </dd>
                </div>
              )}
              {discoveryEnabled && (
                <div>
                  <dt>Lượt tìm kiếm tháng này</dt>
                  <dd>
                    {data.usage
                      .filter((u) => u.kind === "discover")
                      .reduce((n, u) => n + u.calls, 0)}
                    <span>/{plan.discovery_month}</span>
                  </dd>
                </div>
              )}
            </dl>
            <label className="account-check custom-plan-option">
              <input
                type="checkbox"
                checked={data.includeDigest}
                disabled={busy}
                onChange={(e) => {
                  const checked = e.target.checked;
                  void action(async () => {
                    await api(
                      "/api/account/custom-preferences",
                      { includeDigest: checked },
                      "PUT",
                    );
                  });
                }}
              />
              Thêm kết quả vào bản tin
            </label>
          </>
        )}
      </section>
      {error && !editingWatch && (
        <p role="alert" className="status error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="status success">
          {notice}
        </p>
      )}
      <section
        className="account-card custom-watch-panel"
        hidden={view !== "watches" || !!draft}
      >
        <div className="custom-section-heading">
          <h2>Theo dõi của tôi</h2>
          <div className="custom-buttons">
            {plan.premium ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => edit()}
              >
                Tạo theo dõi
              </button>
            ) : (
              <button className="primary" onClick={() => setView("plan")}>
                {data.signup?.status === "pending"
                  ? "Xem đăng ký"
                  : "Xem gói Premium"}
              </button>
            )}
            {plan.premium && watches.length > 0 && (
              <button disabled={busy} onClick={() => void action(load)}>
                Tải lại
              </button>
            )}
          </div>
        </div>
        {!watches.length && (
          <p className="custom-empty">
            {plan.premium
              ? "Tạo theo dõi để nhận tin theo chủ đề bạn quan tâm."
              : "Cần Premium để tạo theo dõi riêng."}
          </p>
        )}
        <ul className="custom-list custom-watch-list">
          {watches.map((w) => (
            <li key={w.id}>
              <div className="custom-watch-body">
                <h3>{w.name}</h3>
                <div className="custom-watch-meta">
                  <span
                    className="custom-watch-state"
                    data-active={w.enabled && plan.premium}
                  >
                    {w.enabled
                      ? plan.premium
                        ? "Đang bật"
                        : "Gói hết hạn"
                      : "Đã tạm dừng"}
                  </span>
                  <span>{frequency(w.interval_minutes)}</span>
                </div>
                <p className="custom-meta">
                  {w.last_run_at
                    ? `Kiểm tra gần nhất ${when(w.last_run_at)}`
                    : "Chưa kiểm tra"}
                </p>
                {w.last_error && <p role="status">{w.last_error}</p>}
              </div>
              <div className="custom-buttons">
                <button
                  disabled={!plan.premium || busy}
                  onClick={() => edit(w)}
                >
                  Sửa
                </button>
                <details className="custom-watch-actions">
                  <summary>
                    Tùy chọn <Icon name="chevron" size={15} />
                  </summary>
                  <div className="custom-buttons">
                    {w.enabled && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await api(
                              "/api/account/watches/" + w.id,
                              { enabled: false },
                              "PATCH",
                            );
                          })
                        }
                      >
                        Tạm dừng
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Xóa nhu cầu khỏi danh sách và dừng theo dõi?",
                          )
                        )
                          void action(async () => {
                            await api(
                              "/api/account/watches/" + w.id,
                              {},
                              "DELETE",
                            );
                          });
                      }}
                    >
                      Xóa
                    </button>
                  </div>
                </details>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {draft && (
        <section
          className="account-card custom-editor"
          hidden={view !== "watches"}
        >
          <h2 ref={editorTitle} tabIndex={-1}>
            {preview
              ? "Xem trước theo dõi"
              : editing
                ? "Sửa theo dõi"
                : "Tạo theo dõi"}
          </h2>
          <form onSubmit={submit} noValidate>
            <fieldset disabled={busy}>
              <div hidden={preview}>
                <label>
                  Tên theo dõi
                  <input
                    required
                    maxLength={100}
                    placeholder="Ví dụ: Thực tập IT tại Hà Nội"
                    value={draft.name}
                    onChange={(e) => change({ name: e.target.value })}
                  />
                </label>
                {assistantEnabled && (
                  <label>
                    Bạn muốn theo dõi điều gì?
                    <textarea
                      maxLength={2000}
                      placeholder="Ví dụ: Việc thực tập IT tại Hà Nội"
                      value={draft.description}
                      onChange={(e) => change({ description: e.target.value })}
                    />
                  </label>
                )}
                {assistantEnabled && (
                  <small>
                    Mô tả sẽ được gửi đến dịch vụ AI khi bạn yêu cầu gợi ý.
                  </small>
                )}
                {assistantEnabled && (
                  <button
                    type="button"
                    disabled={!draft.description || !!job}
                    onClick={() =>
                      void action(async () => {
                        const key = interpretKey ?? crypto.randomUUID();
                        setInterpretKey(key);
                        const r = await api<{ runId: string }>(
                          "/api/account/custom-interpret",
                          { description: draft.description },
                          "POST",
                          key,
                        );
                        setJob(r.runId);
                        setJobStatus("queued");
                      })
                    }
                  >
                    Gợi ý điều kiện bằng trợ lý
                  </button>
                )}
                {job && (
                  <p role="status">
                    Trợ lý{" "}
                    {jobStatus === "queued"
                      ? "đang chờ xử lý"
                      : "đang chuẩn bị điều kiện"}
                    .{" "}
                    <button type="button" onClick={() => void action(checkJob)}>
                      Kiểm tra kết quả
                    </button>
                  </p>
                )}
                <label>
                  Tin cần có những từ nào?
                  <input
                    placeholder="Ví dụ: thực tập, IT"
                    value={draft.conditions.include.join(",")}
                    onChange={(e) =>
                      change({
                        conditions: {
                          ...draft.conditions,
                          include: e.target.value
                            ? e.target.value.split(",")
                            : [],
                        },
                      })
                    }
                    aria-describedby="watch-keywords-hint"
                  />
                </label>
                <p id="watch-keywords-hint" className="custom-field-help">
                  Tin phải có đủ các từ bạn nhập. Ngăn cách các từ bằng dấu
                  phẩy.
                </p>
                <fieldset className="custom-source-picker">
                  <legend>Lấy tin từ đâu?</legend>
                  <p>
                    {sources.length
                      ? "Chọn các trang bạn muốn lấy tin."
                      : "Chưa có trang để chọn."}
                  </p>
                  <SourceChoices
                    sources={starterSources.length ? starterSources : sources}
                    selected={draft.sourceIds}
                    onChange={(sourceIds) => change({ sourceIds })}
                  />
                  {starterSources.length > 0 && otherSources.length > 0 && (
                    <details className="custom-source-other">
                      <summary>Trang khác</summary>
                      <SourceChoices
                        sources={otherSources}
                        selected={draft.sourceIds}
                        onChange={(sourceIds) => change({ sourceIds })}
                      />
                    </details>
                  )}
                  <div className="custom-buttons custom-source-actions">
                    <button
                      type="button"
                      onClick={() => sourceDialog.current?.showModal()}
                    >
                      Thêm nguồn RSS
                    </button>
                    <button type="button" onClick={() => void action()}>
                      Tải lại nguồn
                    </button>
                  </div>
                  {sourceSent && (
                    <p role="status">
                      Đã gửi để duyệt. Khi được duyệt, tải lại nguồn rồi tích chọn.
                    </p>
                  )}
                </fieldset>
                <label>
                  Kiểm tra tin bao lâu một lần?
                  <select
                    value={
                      customInterval ? "custom" : String(draft.intervalMinutes)
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      setManualInterval(value === "custom");
                      if (value !== "custom")
                        change({ intervalMinutes: Number(value) });
                    }}
                  >
                    {intervalChoices.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {frequency(minutes)}
                      </option>
                    ))}
                    <option value="custom">Tự chọn thời gian</option>
                  </select>
                </label>
                {customInterval && (
                  <label>
                    Số phút giữa hai lần kiểm tra
                    <input
                      type="number"
                      min={plan.min_interval_minutes}
                      max={43200}
                      required
                      value={draft.intervalMinutes}
                      onChange={(e) =>
                        change({ intervalMinutes: Number(e.target.value) })
                      }
                    />
                  </label>
                )}
                <details className="custom-disclosure">
                  <summary>Lọc thêm (không bắt buộc)</summary>
                  {!assistantEnabled && (
                    <label>
                      Ghi chú cho theo dõi này
                      <textarea
                        maxLength={2000}
                        placeholder="Ví dụ: Việc thực tập IT tại Hà Nội"
                        value={draft.description}
                        onChange={(e) =>
                          change({ description: e.target.value })
                        }
                      />
                    </label>
                  )}
                  <small>
                    Chỉ điền mục bạn cần. Dùng dấu phẩy nếu nhập nhiều mục.
                  </small>
                  <div className="account-grid">
                    {(
                      [
                        [
                          "exclude",
                          "Bỏ qua tin có những từ sau",
                          "Ví dụ: bán hàng, toàn thời gian",
                        ],
                        [
                          "regions",
                          "Khu vực quan tâm",
                          "Ví dụ: Hà Nội, Đà Nẵng",
                        ],
                        [
                          "opportunityTypes",
                          "Loại tin bạn muốn tìm",
                          "Ví dụ: thực tập, tuyển dụng",
                        ],
                      ] as const
                    ).map(([key, label, example]) => (
                      <label key={key}>
                        {label}
                        <input
                          placeholder={example}
                          value={draft.conditions[key].join(",")}
                          onChange={(e) =>
                            change({
                              conditions: {
                                ...draft.conditions,
                                [key]: e.target.value
                                  ? e.target.value.split(",")
                                  : [],
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      Hạn nộp hồ sơ từ ngày
                      <input
                        type="date"
                        value={draft.conditions.deadlineAfter ?? ""}
                        onChange={(e) =>
                          change({
                            conditions: {
                              ...draft.conditions,
                              deadlineAfter: e.target.value || null,
                            },
                          })
                        }
                      />
                      <small>
                        Chỉ hiện tin có ngày hết hạn mà hệ thống đọc được.
                      </small>
                    </label>
                    <label>
                      Xem lại tin trong bao nhiêu ngày?
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={draft.lookbackDays}
                        onChange={(e) =>
                          change({ lookbackDays: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                  <label className="account-check">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) => change({ enabled: e.target.checked })}
                    />
                    Bắt đầu theo dõi sau khi lưu
                  </label>
                  <small>
                    Với ngày trước, hệ thống tìm trong các tin đã lưu.
                  </small>
                </details>
              </div>
              {preview && (
                <div className="custom-preview">
                  <p>
                    {draft.name || "Chưa đặt tên"} ·{" "}
                    {frequency(draft.intervalMinutes)}
                  </p>
                  <p>
                    Trang lấy tin{" "}
                    {sources
                      .filter((s) => draft.sourceIds.includes(s.id))
                      .map((s) => s.name)
                      .join(", ") || "Chưa chọn"}
                  </p>
                  <dl>
                    {Object.entries(draft.conditions)
                      .filter(([, value]) =>
                        Array.isArray(value) ? value.length > 0 : value,
                      )
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt>
                            {
                              {
                                include: "Bắt buộc",
                                exclude: "Loại trừ",
                                regions: "Khu vực",
                                opportunityTypes: "Loại cơ hội",
                                deadlineAfter: "Hạn từ ngày",
                              }[k]
                            }
                          </dt>
                          <dd>{Array.isArray(v) ? v.join(", ") : v}</dd>
                        </div>
                      ))}
                  </dl>
                  {!draft.enabled && <p>Lưu ở trạng thái tạm dừng.</p>}
                  <label className="account-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    Tôi đã kiểm tra trang lấy tin và lịch theo dõi
                  </label>
                </div>
              )}
              {error && (
                <p role="alert" className="status error">
                  {error}
                </p>
              )}
              <div className="custom-buttons">
                <button
                  className="primary"
                  disabled={busy || (preview && !confirmed)}
                >
                  {busy
                    ? "Đang lưu…"
                    : preview
                      ? "Xác nhận và lưu"
                      : "Xem trước"}
                </button>
                {preview && (
                  <button
                    type="button"
                    onClick={() => {
                      setPreview(false);
                      setConfirmed(false);
                    }}
                  >
                    Sửa lại
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setNotice("");
                  }}
                >
                  Hủy
                </button>
              </div>
            </fieldset>
          </form>
          <SourceProposal
            dialog={sourceDialog}
            onSent={() => setSourceSent(true)}
          />
        </section>
      )}
      <div className="custom-results-view" hidden={view !== "results"}>
        {plan.premium && (
          <section
            className="account-card custom-web-panel"
            aria-labelledby="custom-web-heading"
          >
            <div className="custom-web-heading">
              <span className="custom-web-symbol">
                <Icon name="search" size={23} />
              </span>
              <h2 id="custom-web-heading">Tìm và tổng hợp trên web</h2>
            </div>
            {livePreview || (data.aiEnabled && data.searchEnabled) ? (
              <WebBrief livePreview={livePreview} />
            ) : (
              <p>Tìm kiếm web đang tắt. Liên hệ quản trị viên để bật.</p>
            )}
          </section>
        )}
        <section
          className="account-card custom-result-panel"
          hidden={
            livePreview &&
            !watches.length &&
            !results.length &&
            !hasNextPage &&
            page === 1
          }
        >
          <div className="custom-section-heading">
            <h2>Tin theo dõi</h2>
            <button disabled={busy} onClick={() => void action(load)}>
              Cập nhật kết quả
            </button>
          </div>
          {!results.length && (
            <p className="custom-empty">
              {!watches.some((watch) => watch.enabled)
                ? "Bật một theo dõi để nhận kết quả."
                : watches.some(
                      (watch) =>
                        watch.enabled &&
                        watch.source_ids.every(
                          (id) => !sources.some((source) => source.id === id),
                        ),
                    )
                  ? "Nguồn đã chọn không còn được duyệt. Chọn nguồn khác trong Theo dõi của tôi."
                  : watches.some((watch) => watch.enabled && watch.last_error)
                    ? "Có nguồn không cập nhật được. Xem chi tiết trong Theo dõi của tôi."
                    : watches.some(
                          (watch) => watch.enabled && !watch.last_run_at,
                        )
                      ? "Đang chờ lần kiểm tra đầu tiên."
                      : "Chưa có tin khớp. Thử điều chỉnh từ khóa hoặc đổi nguồn."}
            </p>
          )}
          {plan.premium &&
            assistantEnabled &&
            results.some((item) => !item.hidden) && (
              <TopicSummary results={results} />
            )}
          <ul className="custom-list custom-result-list">
            {results.map((r) => (
              <li key={r.watch_id + r.article_id}>
                <h3>
                  <a href={r.url} target="_blank" rel="noopener noreferrer">
                    {r.title}
                  </a>
                </h3>
                <div className="custom-article-meta">
                  <strong>{r.source_name}</strong>
                  <time dateTime={r.published_at}>{when(r.published_at)}</time>
                </div>
                {r.description && (
                  <p className="custom-article-excerpt">{r.description}</p>
                )}
                <div className="custom-buttons custom-article-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api(
                          `/api/account/custom-results/${r.watch_id}/${r.article_id}`,
                          { saved: !r.saved, hidden: r.hidden },
                          "PATCH",
                        );
                      })
                    }
                  >
                    {r.saved ? "Bỏ lưu" : "Lưu"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api(
                          `/api/account/custom-results/${r.watch_id}/${r.article_id}`,
                          { saved: r.saved, hidden: !r.hidden },
                          "PATCH",
                        );
                      })
                    }
                  >
                    {r.hidden ? "Thêm lại vào bản tin" : "Ẩn khỏi bản tin"}
                  </button>
                </div>
                <details className="custom-disclosure custom-article-details">
                  <summary>Chi tiết tin</summary>
                  <p>
                    <strong>{r.watch_name}</strong> · {r.reason}
                  </p>
                  <small>Nguồn cập nhật {when(r.fetched_at)}</small>
                  {plan.premium && assistantEnabled && (
                    <Enrichment articleId={r.article_id} onAction={action} />
                  )}
                </details>
              </li>
            ))}
          </ul>
          {(page > 1 || hasNextPage) && (
            <div className="custom-buttons">
              <button
                disabled={page === 1 || busy}
                onClick={() => setPage((p) => p - 1)}
              >
                Trang trước
              </button>
              <span>Trang {page}</span>
              <button
                disabled={!hasNextPage || busy}
                onClick={() => setPage((p) => p + 1)}
              >
                Trang sau
              </button>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
function SourceProposal({
  dialog,
  onSent,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  onSent: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setSending(true);
    setError("");
    try {
      await api("/api/account/custom-sources", {
        name: fields.get("name"),
        url: fields.get("url"),
      });
      form.reset();
      dialog.current?.close();
      onSent();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="custom-source-dialog"
      aria-labelledby="source-proposal-title"
      aria-describedby="source-proposal-help"
    >
      <h2 id="source-proposal-title">Thêm nguồn RSS</h2>
      <p id="source-proposal-help">
        Dán đường dẫn RSS hoặc Atom. Quản trị viên sẽ kiểm tra và duyệt nguồn.
      </p>
      <form onSubmit={send}>
        <fieldset disabled={sending}>
          <label>
            Tên nguồn <input name="name" required maxLength={100} />
          </label>
          <label>
            Đường dẫn RSS hoặc Atom
            <input name="url" type="url" required maxLength={2000} />
          </label>
          {error && (
            <p className="status error" role="alert">{error}</p>
          )}
          <div className="custom-buttons">
            <button className="primary">
              {sending ? "Đang gửi…" : "Gửi để duyệt"}
            </button>
            <button type="button" onClick={() => dialog.current?.close()}>
              Quay lại
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
function PremiumSignup({
  signup,
  offer,
  email,
  busy,
  onAction,
}: {
  signup: Subscription["signup"];
  offer?: Subscription["premiumOffer"];
  email: string;
  busy: boolean;
  onAction: (work: () => Promise<void>) => Promise<void>;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(email);
      setCopyStatus("Đã sao chép email.");
    } catch {
      setCopyStatus("Hãy chọn và sao chép email ở trên.");
    }
  }
  const payment = (
    <div className="custom-payment">
      <div>
        <h3>Chuyển khoản để đăng ký</h3>
        <strong className="custom-payment-amount">20.000 ₫</strong>
        <p>Dùng email đăng nhập làm nội dung chuyển khoản.</p>
        <strong className="custom-payment-email">{email}</strong>
        <button type="button" onClick={() => void copyEmail()}>
          Sao chép email
        </button>
        {copyStatus && <p role="status">{copyStatus}</p>}
      </div>
      <a
        href={paymentQr}
        download="ma-qr-premium.png"
        className="custom-payment-qr"
        aria-label="Tải mã QR chuyển khoản Agribank"
      >
        <img
          src={paymentQr}
          alt="Mã QR chuyển khoản Agribank"
          width={1125}
          height={1812}
          loading="lazy"
        />
        <span>Tải mã QR</span>
      </a>
    </div>
  );
  return (
    <div className="custom-signup">
      <p>
        {offer
          ? `Premium cho phép tạo tối đa ${offer.active_watches} theo dõi và đưa tin phù hợp vào bản tin.`
          : "Premium cho phép tạo theo dõi và đưa tin phù hợp vào bản tin."}
      </p>
      {signup?.status === "pending" ? (
        <>
          <div role="status" className="custom-pending">
            <strong>Đăng ký đang chờ duyệt</strong>
            <p>Quản trị viên sẽ đối chiếu khoản chuyển trước khi kích hoạt Premium.</p>
          </div>
          <details className="custom-disclosure">
            <summary>Xem thông tin chuyển khoản</summary>
            {payment}
          </details>
        </>
      ) : (
        <>
          {payment}
          {signup?.status === "declined" && (
            <p role="status">
              Yêu cầu trước chưa được duyệt: {signup.review_note}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void onAction(async () => {
                await api("/api/account/premium-request", {
                  note: f.get("note") ?? "",
                });
              });
            }}
          >
            <fieldset disabled={busy}>
              <details className="custom-disclosure">
                <summary>Thêm ghi chú (tùy chọn)</summary>
                <label>
                  Ghi chú cho quản trị viên
                  <textarea name="note" maxLength={500} />
                </label>
              </details>
              <button className="primary">
                {busy ? "Đang gửi…" : "Đã chuyển khoản"}
              </button>
            </fieldset>
          </form>
        </>
      )}
    </div>
  );
}
type TopicBrief = {
  summary: string;
  summaryNotice?: string;
  articles: { title: string; url: string }[];
};
function WebBrief({ livePreview }: { livePreview: boolean }) {
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<TopicBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const request = useRef<{
    query: string;
    searchKey: string;
    summaryKey: string;
    searchId?: string;
    summaryId?: string;
  } | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function waitForJob<T>(id: string, signal: AbortSignal) {
    for (let attempt = 0; attempt < 40; attempt++) {
      signal.throwIfAborted();
      const job = await api<{
        status: string;
        result: T | null;
        error?: { message: string };
      }>("/api/account/custom-jobs/" + id);
      if (job.status === "completed" && job.result) return job.result;
      if (job.status !== "queued" && job.status !== "running") {
        request.current = null;
        throw new Error(job.error?.message ?? "Chưa nhận được kết quả.");
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
    }
    throw new Error("Yêu cầu vẫn đang xử lý. Bấm Tiếp tục để kiểm tra.");
  }
  async function start(event: FormEvent) {
    event.preventDefault();
    const description = query.trim();
    if (description.length < 5 || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      if (livePreview) {
        setMessage("Đang tìm nguồn thật và tổng hợp…");
        const brief = await api<TopicBrief>("/api/account/custom-web-preview", {
          description,
        });
        controller.signal.throwIfAborted();
        if (brief.articles.length) setResult(brief);
        setMessage(
          brief.articles.length
            ? ""
            : "Chưa tìm được nguồn phù hợp. Thử nêu rõ địa điểm hoặc thời gian.",
        );
        return;
      }
      const job = (request.current ??= {
        query: description,
        searchKey: crypto.randomUUID(),
        summaryKey: crypto.randomUUID(),
      });
      if (!job.summaryId) {
        setMessage("Đang tìm trên web…");
        job.searchId ??= (
          await api<{ runId: string }>(
            "/api/account/custom-web-brief",
            { description: job.query },
            "POST",
            job.searchKey,
          )
        ).runId;
        const search = await waitForJob<DiscoveryResult>(
          job.searchId,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        if (!search.candidates.length) {
          request.current = null;
          setMessage(
            "Chưa tìm được nguồn phù hợp. Thử nêu rõ địa điểm hoặc thời gian.",
          );
          return;
        }
        setMessage("Đang tổng hợp…");
        job.summaryId = (
          await api<{ runId: string }>(
            "/api/account/custom-web-brief",
            { searchRunId: job.searchId },
            "POST",
            job.summaryKey,
          )
        ).runId;
      }
      setMessage("Đang tổng hợp…");
      const brief = await waitForJob<TopicBrief>(
        job.summaryId,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      request.current = null;
      setResult(brief);
      setMessage("");
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError((failure as Error).message);
        setMessage("");
      }
    } finally {
      active.current = null;
      if (!controller.signal.aborted) {
        setPending(request.current !== null);
        setBusy(false);
      }
    }
  }
  return (
    <form className="custom-web-form" onSubmit={start}>
      <div className="custom-web-query">
        <label>
          Bạn muốn tìm gì?
          <textarea
            value={query}
            onChange={(event) => {
              request.current = null;
              setPending(false);
              setQuery(event.target.value);
            }}
            placeholder="Ví dụ: Vị trí thực tập IT ở Hà Nội cho sinh viên năm cuối"
            required
            minLength={5}
            maxLength={300}
            disabled={busy}
          />
        </label>
        <small>
          Câu hỏi được gửi tới dịch vụ tìm kiếm. AI đọc các trích đoạn từ web.
          Tránh nhập dữ liệu cá nhân.
        </small>
        <div className="custom-buttons">
          <button
            className="primary"
            type="submit"
            disabled={busy || query.trim().length < 5}
          >
            {busy ? "Đang xử lý…" : pending ? "Tiếp tục" : "Tìm và tổng hợp"}
          </button>
        </div>
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
      {result && <BriefResult result={result} />}
    </form>
  );
}

function BriefResult({ result }: { result: TopicBrief }) {
  return (
    <div className="custom-brief">
      {result.summary && <p>{result.summary}</p>}
      {result.summaryNotice && <p role="status">{result.summaryNotice}</p>}
      <h3>Nguồn tham khảo</h3>
      <ol aria-label="Nguồn tham khảo">
        {result.articles.map((article) => (
          <li key={article.url}>
            <a href={article.url} target="_blank" rel="noopener noreferrer">
              {article.title}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
function TopicSummary({ results }: { results: Match[] }) {
  const watches = new Map(
    results
      .filter((item) => !item.hidden)
      .map((item) => [item.watch_id, item.watch_name]),
  );
  const [selected, setSelected] = useState("");
  const watchId = watches.has(selected)
    ? selected
    : (watches.keys().next().value ?? "");
  return (
    <details className="custom-disclosure">
      <summary>Tổng hợp theo dõi bằng AI</summary>
      <label>
        Theo dõi
        <select
          value={watchId}
          onChange={(event) => setSelected(event.target.value)}
        >
          {[...watches].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <TopicBriefRequest key={watchId} watchId={watchId} />
    </details>
  );
}

function TopicBriefRequest({ watchId }: { watchId: string }) {
  const [job, setJob] = useState<string | null>(null);
  const [result, setResult] = useState<TopicBrief | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestKey = useRef<string | null>(null);
  async function summarize() {
    setBusy(true);
    setError("");
    try {
      if (!job) {
        requestKey.current ??= crypto.randomUUID();
        const request = await api<{ runId: string }>(
          "/api/account/custom-summary/" + watchId,
          {},
          "POST",
          requestKey.current,
        );
        setJob(request.runId);
      } else {
        const reply = await api<{
          status: string;
          result: TopicBrief | null;
          error?: { message: string };
        }>("/api/account/custom-jobs/" + job);
        if (
          reply.status === "completed" ||
          reply.status === "failed" ||
          reply.status === "cancelled"
        ) {
          setJob(null);
          requestKey.current = null;
          if (!reply.result)
            throw new Error(
              reply.error?.message ?? "Chưa tổng hợp được thông tin.",
            );
          setResult(reply.result);
        }
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <small>AI xử lý tiêu đề và trích đoạn của tối đa 6 tin gần nhất.</small>
      <div className="custom-buttons">
        <button type="button" disabled={busy} onClick={() => void summarize()}>
          {busy
            ? "Đang xử lý…"
            : job
              ? "Kiểm tra bản tổng hợp"
              : "Tạo bản tổng hợp"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {job && <p role="status">Đã gửi yêu cầu tổng hợp.</p>}
      {result && <BriefResult result={result} />}
    </div>
  );
}

type DiscoveryResult = {
  candidates: { name: string; url: string; evidence: string }[];
};
function Enrichment({
  articleId,
  onAction,
}: {
  articleId: string;
  onAction: (work: () => Promise<void>) => Promise<void>;
}) {
  const [job, setJob] = useState<string | null>(null),
    [key, setKey] = useState<string | null>(null),
    [result, setResult] = useState<{
      summary: string;
      deadline: string | null;
      evidence: string[];
    } | null>(null);
  return (
    <div>
      {!job && !result && (
        <button
          onClick={() =>
            void onAction(async () => {
              const requestKey = key ?? crypto.randomUUID();
              setKey(requestKey);
              const r = await api<{ runId?: string; result?: typeof result }>(
                "/api/account/custom-enrich/" + articleId,
                {},
                "POST",
                requestKey,
              );
              if (r.result) setResult(r.result);
              else setJob(r.runId ?? null);
            })
          }
        >
          Trích xuất thông tin bằng trợ lý
        </button>
      )}
      {job && (
        <button
          onClick={() =>
            void onAction(async () => {
              const r = await api<{
                status: string;
                result: typeof result;
                error?: { message: string };
              }>("/api/account/custom-jobs/" + job);
              if (r.status === "completed") {
                setResult(r.result);
                setJob(null);
                setKey(null);
              } else if (r.status === "failed") {
                setJob(null);
                setKey(null);
                throw new Error(r.error?.message ?? "Không trích xuất được.");
              }
            })
          }
        >
          Kiểm tra trích xuất đang xử lý
        </button>
      )}
      {result && (
        <>
          <p>{result.summary}</p>
          <p>
            Hạn được trích xuất: {result.deadline ?? "Chưa xác định"}; cần kiểm
            tra tại nguồn.
          </p>
          {result.evidence.map((s, i) => (
            <blockquote key={i}>{s}</blockquote>
          ))}
        </>
      )}
    </div>
  );
}
type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  plan_id: string | null;
  expires_at: string | null;
};
type AdminData = {
  requests: {
    user_id: string;
    name: string;
    email: string;
    note: string;
    requested_at: string;
  }[];
  users: AdminUser[];
  audits: {
    id: string;
    action: string;
    created_at: string;
    subject_id: string | null;
  }[];
  plans: {
    id: string;
    active_watches: number;
    discovery_month: number;
    ai_calls_month: number;
    min_interval_minutes: number;
  }[];
};
type SourceStatus = "pending" | "approved" | "rejected";
type AdminSource = Source & { status: SourceStatus; canReplaceFeed: boolean };
type AiData = {
  config: AiControl;
  sources: AdminSource[];
  usage: {
    id: string;
    provider: string;
    model: string;
    kind: string;
    status: string;
    reserved_micros: string;
    estimated_micros: string | null;
    error_code: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    search_units: number | null;
    pricing_version: string;
  }[];
  jobs: { run_id: string; kind: string; error: { message: string } | null }[];
};
const sourceStatusLabels = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
} as const;

function AdminSources({
  sources,
  onReviewed,
  onAdded,
}: {
  sources: AdminSource[];
  onReviewed: (source: AdminSource) => void;
  onAdded: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<SourceStatus | "all">("all");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setAdding(true);
    setAddError("");
    setNotice("");
    try {
      const result = await api<{ id: string | null }>(
        "/api/admin/custom-sources",
        {
          name: fields.get("name"),
          url: fields.get("url"),
        },
      );
      if (!result.id)
        throw new Error("Địa chỉ này đã có trong danh sách nguồn.");
      form.reset();
      await onAdded();
      setFilter("pending");
      setNotice("Đã thêm nguồn vào danh sách chờ duyệt.");
    } catch (failure) {
      setAddError((failure as Error).message);
    } finally {
      setAdding(false);
    }
  }
  return (
    <section
      className="account-card custom-admin-panel custom-admin-sources"
      id="admin-sources"
      aria-labelledby="admin-sources-title"
    >
      <h2 id="admin-sources-title">
        <Icon name="brief" /> Nguồn tin
      </h2>
      <details className="custom-disclosure">
        <summary>Thêm nguồn tin</summary>
        <form onSubmit={addSource} className="custom-admin-add-source">
          <fieldset disabled={adding}>
            <label>
              Tên nguồn <input name="name" required maxLength={100} />
            </label>
            <label>
              Đường dẫn RSS/Atom{" "}
              <input name="url" type="url" required maxLength={2000} />
            </label>
            {addError && (
              <p className="status error" role="alert">
                {addError}
              </p>
            )}
            <button className="primary">
              {adding ? "Đang thêm…" : "Thêm nguồn"}
            </button>
          </fieldset>
        </form>
      </details>
      <div
        className="custom-admin-filters"
        role="group"
        aria-label="Lọc nguồn theo trạng thái"
      >
        {(["all", "pending", "approved", "rejected"] as const).map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={filter === status}
            onClick={() => setFilter(status)}
          >
            {status === "all" ? "Tất cả" : sourceStatusLabels[status]}
            <span>
              {status === "all"
                ? sources.length
                : sources.filter((source) => source.status === status).length}
            </span>
          </button>
        ))}
      </div>
      {notice && (
        <p className="status success" role="status">
          {notice}
        </p>
      )}
      {!sources.some(
        (source) => filter === "all" || source.status === filter,
      ) && <p>Chưa có nguồn ở trạng thái này.</p>}
      <ul className="custom-admin-source-list">
        {sources
          .filter((source) => filter === "all" || source.status === filter)
          .map((source) => (
            <AdminSourceReview
              key={source.id}
              source={source}
              onReviewed={(reviewed) => {
                onReviewed(reviewed);
                setNotice(
                  `${reviewed.name} · ${sourceStatusLabels[reviewed.status]}`,
                );
              }}
            />
          ))}
      </ul>
    </section>
  );
}

function AdminSourceReview({
  source,
  onReviewed,
}: {
  source: AdminSource;
  onReviewed: (source: AdminSource) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function review(status: "approved" | "rejected", feedUrl?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ source: AdminSource }>(
        "/api/admin/custom-sources/" + source.id,
        { status, ...(feedUrl ? { feedUrl } : {}) },
        "PUT",
      );
      onReviewed(result.source);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="custom-admin-source-row">
      <div className="custom-admin-source-heading">
        <div>
          <h3>{source.name}</h3>
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            {source.url}
          </a>
        </div>
        <span className="custom-admin-status" data-status={source.status}>
          {sourceStatusLabels[source.status]}
        </span>
      </div>
      {source.last_error && (
        <p className="custom-admin-source-note">{source.last_error}</p>
      )}
      <form
        key={source.status}
        onSubmit={(event) => {
          event.preventDefault();
          const feedUrl = String(
            new FormData(event.currentTarget).get("feedUrl") ?? "",
          ).trim();
          void review("approved", feedUrl);
        }}
      >
        {source.canReplaceFeed && (
          <label>
            Đường dẫn RSS/Atom
            <input
              type="url"
              name="feedUrl"
              disabled={busy}
              maxLength={2000}
              placeholder="Dán đường dẫn lấy tin nếu trang đã gửi khác RSS/Atom"
            />
          </label>
        )}
        {error && (
          <p className="status error" role="alert">
            {error}
          </p>
        )}
        <div className="custom-buttons">
          {source.status !== "approved" && (
            <button className="primary" type="submit" disabled={busy}>
              {busy
                ? "Đang kiểm tra…"
                : source.status === "rejected"
                  ? "Kiểm tra và duyệt lại"
                  : "Kiểm tra và duyệt nguồn"}
            </button>
          )}
          {source.status !== "rejected" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void review("rejected")}
            >
              {source.status === "approved" ? "Ngừng lấy tin" : "Từ chối"}
            </button>
          )}
        </div>
      </form>
    </li>
  );
}

type AiNumberKey = {
  [Key in keyof AiControl]: AiControl[Key] extends number ? Key : never;
}[keyof AiControl];

function AdminAiNumbers({
  config,
  onChange,
  fields,
}: {
  config: AiControl;
  onChange: (config: AiControl) => void;
  fields: [AiNumberKey, string, number?][];
}) {
  return (
    <div className="custom-ai-numbers">
      {fields.map(([key, label, min = 0]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min={min}
            value={config[key]}
            onChange={(event) =>
              onChange({ ...config, [key]: Number(event.target.value) })
            }
          />
        </label>
      ))}
    </div>
  );
}

function PremiumAdmin() {
  const [data, setData] = useState<AdminData | null>(null),
    [ai, setAi] = useState<AiData | null>(null),
    [config, setConfig] = useState<AiControl | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"accounts" | "sources" | "ai">("accounts");
  const [livePreview, setLivePreview] = useState(false);
  async function load() {
    const [d, a, preview] = await Promise.all([
      api<AdminData>("/api/admin/premium"),
      api<AiData>("/api/admin/custom-ai"),
      import.meta.env.DEV
        ? api<{ live: boolean }>("/api/account/custom-web-preview").catch(
            () => ({ live: false }),
          )
        : { live: false },
    ]);
    setData(d);
    setAi(a);
    setConfig(a.config);
    setLivePreview(preview.live);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await load();
      setNotice("Đã lưu và ghi nhật ký quản trị.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="custom-portal custom-admin">
      <div className="custom-section-heading">
        <h1>Quản trị Premium &amp; AI</h1>
        <button disabled={busy} onClick={() => void action(load)}>
          Tải lại
        </button>
      </div>
      <nav className="custom-admin-tabs" aria-label="Quản trị Premium">
        {(
          [
            ["accounts", "Tài khoản", "user"],
            ["sources", "Nguồn tin", "brief"],
            ["ai", "AI và tìm kiếm", "sparkle"],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            data-tab={key}
            onClick={() => setTab(key)}
          >
            <Icon name={icon} size={20} /> {label}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!data && <p role="status">Đang tải…</p>}
      <section
        className="account-card custom-admin-panel custom-admin-accounts"
        hidden={tab !== "accounts" || !data}
      >
        <h2>
          <Icon name="user" /> Tài khoản Premium
        </h2>
        {data && (
          <section className="custom-pending-requests">
            <h2>Đăng ký đang chờ duyệt ({data.requests.length})</h2>
            {data.requests.length > 0 && (
              <p>Đối chiếu khoản chuyển 20.000 ₫ và email đăng nhập trước khi duyệt.</p>
            )}
            {!data.requests.length && <p>Chưa có yêu cầu mới.</p>}
            <ul className="custom-list">
              {data.requests.map((r) => (
                <li key={r.user_id}>
                  <h3>{r.name}</h3>
                  <p>
                    {r.email} · Gửi {when(r.requested_at)}
                  </p>
                  {r.note && <p>{r.note}</p>}
                  <div className="custom-buttons">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await api(
                            "/api/admin/premium/" + r.user_id,
                            {
                              plan: "premium",
                              expiresAt: new Date(
                                Date.now() + 30 * 86400000,
                              ).toISOString(),
                              reason:
                                "Duyệt đăng ký Premium thử nghiệm 30 ngày",
                            },
                            "PUT",
                          );
                        })
                      }
                    >
                      Duyệt và cấp 30 ngày
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await api(
                            "/api/admin/premium-requests/" +
                              r.user_id +
                              "/decline",
                            {
                              reason:
                                "Hiện chưa mở thêm suất Premium thử nghiệm.",
                            },
                          );
                        })
                      }
                    >
                      Chưa nhận đợt này
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(async () => {
                await api(
                  "/api/admin/premium/" + f.get("user"),
                  {
                    plan: f.get("plan"),
                    expiresAt: f.get("expires")
                      ? new Date(String(f.get("expires"))).toISOString()
                      : null,
                    reason: f.get("reason"),
                  },
                  "PUT",
                );
              });
            }}
          >
            <fieldset disabled={busy}>
              <legend>Cấp / gia hạn / thu hồi</legend>
              <label>
                Tài khoản
                <select name="user">
                  {data.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.email} · {u.plan_id ?? "free"} ·{" "}
                      {when(u.expires_at)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="account-grid">
                <label>
                  Gói
                  <select name="plan">
                    <option value="premium">Premium thử nghiệm</option>
                    <option value="free">Thu hồi Premium / Free</option>
                  </select>
                </label>
                <label>
                  Hết hạn (giờ máy bạn)
                  <input type="datetime-local" name="expires" />
                </label>
              </div>
              <label>
                Lý do
                <input name="reason" required maxLength={300} />
              </label>
              <button className="primary">Áp dụng gói</button>
            </fieldset>
          </form>
        )}
        {data && (
          <details className="custom-disclosure">
            <summary>Hạn mức các gói</summary>
            {data.plans.map((p) => (
              <form
                key={p.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void action(async () => {
                    await api(
                      "/api/admin/plans/" + p.id,
                      {
                        activeWatches: Number(f.get("active")),
                        discoveryMonth: Number(f.get("discovery")),
                        aiCallsMonth: Number(f.get("calls")),
                        minIntervalMinutes: Number(f.get("interval")),
                      },
                      "PUT",
                    );
                  });
                }}
              >
                <fieldset disabled={busy}>
                  <legend>Hạn mức {p.id}</legend>
                  <div className="account-grid">
                    <label>
                      Nhu cầu hoạt động
                      <input
                        name="active"
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={p.active_watches}
                      />
                    </label>
                    <label>
                      Khám phá / tháng
                      <input
                        name="discovery"
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={p.discovery_month}
                      />
                    </label>
                    <label>
                      Trợ lý / tháng
                      <input
                        name="calls"
                        type="number"
                        min={0}
                        max={1000}
                        defaultValue={p.ai_calls_month}
                      />
                    </label>
                    <label>
                      Khoảng kiểm tra tối thiểu (phút)
                      <input
                        name="interval"
                        type="number"
                        min={60}
                        max={43200}
                        defaultValue={p.min_interval_minutes}
                      />
                    </label>
                  </div>
                  <button>Lưu hạn mức</button>
                </fieldset>
              </form>
            ))}
          </details>
        )}
      </section>
      {ai && (
        <div hidden={tab !== "sources"}>
          <AdminSources
            sources={
              livePreview
                ? ai.sources.filter((source) => !isSampleUrl(source.url))
                : ai.sources
            }
            onReviewed={(reviewed) =>
              setAi(
                (current) =>
                  current && {
                    ...current,
                    sources: current.sources.map((source) =>
                      source.id === reviewed.id
                        ? { ...source, ...reviewed }
                        : source,
                    ),
                  },
              )
            }
            onAdded={async () =>
              setAi(await api<AiData>("/api/admin/custom-ai"))
            }
          />
        </div>
      )}
      {config && (
        <section
          className="account-card custom-admin-panel custom-admin-ai"
          hidden={tab !== "ai"}
        >
          <h2>
            <Icon name="sparkle" /> AI và tìm kiếm
          </h2>
          {livePreview && (
            <p>
              Các cài đặt bên dưới áp dụng cho tác vụ đã xếp hàng. Lượt tìm thử
              trên localhost gọi Brave và Gemini trực tiếp.
            </p>
          )}
          <div className="custom-ai-overview">
            <div>
              <strong>Gemini</strong>
              <span
                className="custom-admin-status"
                data-status={ai?.config.enabled ? "approved" : "off"}
              >
                {ai?.config.enabled ? "Đã bật" : "Đã tắt"}
              </span>
            </div>
            <div>
              <strong>Brave</strong>
              <span
                className="custom-admin-status"
                data-status={ai?.config.searchEnabled ? "approved" : "off"}
              >
                {ai?.config.searchEnabled ? "Đã bật" : "Đã tắt"}
              </span>
            </div>
          </div>
          <details className="custom-disclosure">
            <summary>Cấu hình AI và tìm kiếm</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  await api("/api/admin/custom-ai", config, "PUT");
                });
              }}
            >
              <fieldset disabled={busy}>
                <div className="custom-ai-settings-grid">
                  <fieldset className="custom-ai-settings" data-tool="gemini">
                    <legend>Gemini</legend>
                    <label className="account-check">
                      <input
                        type="checkbox"
                        checked={config.enabled}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            enabled: event.target.checked,
                          })
                        }
                      />
                      Bật tổng hợp bằng AI
                    </label>
                    <label>
                      Nhà cung cấp AI
                      <select
                        value={config.provider}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            provider: event.target
                              .value as AiControl["provider"],
                          })
                        }
                      >
                        <option value="disabled">Tắt</option>
                        <option value="gemini">Gemini</option>
                      </select>
                    </label>
                    <label>
                      Model{" "}
                      <input
                        value={config.model}
                        onChange={(event) =>
                          setConfig({ ...config, model: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Phiên bản bảng giá AI{" "}
                      <input
                        value={config.pricingVersion}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            pricingVersion: event.target.value,
                          })
                        }
                      />
                    </label>
                    <AdminAiNumbers
                      config={config}
                      onChange={setConfig}
                      fields={[
                        ["dailyCalls", "Lượt AI / ngày"],
                        ["monthlyTokens", "Token / tháng"],
                        [
                          "inputMicrosPerMillion",
                          "Giá vào (µUSD / triệu token)",
                        ],
                        [
                          "outputMicrosPerMillion",
                          "Giá ra (µUSD / triệu token)",
                        ],
                      ]}
                    />
                  </fieldset>
                  <fieldset className="custom-ai-settings" data-tool="brave">
                    <legend>Brave Search</legend>
                    <label className="account-check">
                      <input
                        type="checkbox"
                        checked={config.searchEnabled}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            searchEnabled: event.target.checked,
                          })
                        }
                      />
                      Bật tìm kiếm web
                    </label>
                    <label>
                      Nhà cung cấp tìm kiếm
                      <select
                        value={config.searchProvider}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            searchProvider: event.target
                              .value as AiControl["searchProvider"],
                          })
                        }
                      >
                        <option value="disabled">Tắt</option>
                        <option value="brave">Brave Search</option>
                      </select>
                    </label>
                    <label>
                      Phiên bản bảng giá tìm kiếm{" "}
                      <input
                        value={config.searchPricingVersion}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            searchPricingVersion: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="account-check">
                      <input
                        type="checkbox"
                        checked={config.searchStorageAllowed}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            searchStorageAllowed: event.target.checked,
                          })
                        }
                      />
                      Gói Brave cho phép lưu kết quả
                    </label>
                    <AdminAiNumbers
                      config={config}
                      onChange={setConfig}
                      fields={[
                        ["dailySearchUnits", "Lượt tìm / ngày"],
                        ["monthlySearchUnits", "Lượt tìm / tháng"],
                        ["searchUnitMicros", "Giá một lượt tìm (µUSD)"],
                      ]}
                    />
                  </fieldset>
                </div>
                <details className="custom-disclosure">
                  <summary>Ngân sách và giới hạn chung</summary>
                  <p>1 USD = 1.000.000 µUSD.</p>
                  <AdminAiNumbers
                    config={config}
                    onChange={setConfig}
                    fields={[
                      ["dailyMicros", "Ngân sách ngày (µUSD)"],
                      ["monthlyMicros", "Ngân sách tháng (µUSD)"],
                      ["concurrency", "Tác vụ chạy đồng thời", 1],
                      ["maxPendingPerUser", "Yêu cầu chờ / tài khoản", 1],
                      ["timeoutMs", "Thời gian chờ tối đa (ms)", 1000],
                    ]}
                  />
                </details>
                <button className="primary">Lưu cấu hình AI</button>
              </fieldset>
            </form>
          </details>
          <details className="custom-disclosure">
            <summary>Mức sử dụng và lỗi tác vụ</summary>
            <h3>Mức sử dụng gần đây</h3>
            <p>
              Trạng thái unknown giữ nguyên phần ngân sách đã đặt chỗ để đối
              soát; không coi là miễn phí.
            </p>
            <ul>
              {ai?.usage.map((u) => (
                <li key={u.id}>
                  {u.kind} · {u.provider}/{u.model} · {u.status} · Ước tính{" "}
                  {u.estimated_micros ?? "chưa biết"}, đặt chỗ{" "}
                  {u.reserved_micros} micro USD {u.error_code}
                  {` · Đầu vào/ra: ${u.input_tokens ?? "?"}/${u.output_tokens ?? "?"} · Tìm kiếm: ${u.search_units ?? "?"} · Giá: ${u.pricing_version}`}
                </li>
              ))}
            </ul>
            <h3>Tác vụ lỗi</h3>
            <ul>
              {ai?.jobs.map((j) => (
                <li key={j.run_id}>
                  {j.kind} · {j.error?.message ?? "Lỗi chưa xác định"}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
      {data && (
        <details
          className="account-card custom-source-tools"
          hidden={tab !== "accounts"}
        >
          <summary>Nhật ký quản trị</summary>
          <ul>
            {data.audits.map((a) => (
              <li key={a.id}>
                {when(a.created_at)} · {a.action} ·{" "}
                {a.subject_id ?? "Toàn hệ thống"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
