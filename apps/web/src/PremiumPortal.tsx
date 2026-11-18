import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  safeExternalHref,
  watchConditionsSchema,
  watchSchema,
  type PaymentConfig,
  type WatchInput,
} from "@hub/contracts";
import { Icon } from "./Icons";
import { isSampleUrl } from "./sample-url";
import { ExternalLink } from "./components/ExternalLink";
import placeholderQr from "./assets/payment-placeholder-qr.svg";
import PremiumAdmin from "./premium/PremiumAdmin";
import {
  cancelCustomJob,
  frequency,
  friendlyAiError,
  premiumApi,
  usualIntervals,
  when,
  type DiscoveryResult,
  type Match,
  type Source,
  type Subscription,
  type TopicBrief,
  type Watch,
} from "./premium/types";
import "./premium.css";

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
  const portalRef = useRef<HTMLElement>(null);
  const [sourceSent, setSourceSent] = useState(false);
  const [view, setView] = useState<"watches" | "results" | "plan">("watches");
  const [savedOnly, setSavedOnly] = useState(false);
  const [data, setData] = useState<Subscription | null>(null);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [results, setResults] = useState<Match[]>([]);
  const [livePreview, setLivePreview] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<WatchInput | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [manualInterval, setManualInterval] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState("");
  const [interpretKey, setInterpretKey] = useState<string | null>(null);

  const editingWatch = draft !== null && view === "watches";

  useEffect(() => {
    if (editingWatch) editorTitle.current?.focus();
  }, [editingWatch, preview]);

  // Close open <details class="custom-watch-actions"> menus on Escape or outside click.
  useEffect(() => {
    const closeOpenMenus = (target?: EventTarget | null) => {
      const root = portalRef.current;
      if (!root) return;
      for (const detail of root.querySelectorAll<HTMLDetailsElement>(
        "details.custom-watch-actions[open]",
      )) {
        if (!target || !(target instanceof Node) || !detail.contains(target)) {
          detail.open = false;
        }
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOpenMenus();
    };
    const onPointerDown = (e: PointerEvent) => {
      closeOpenMenus(e.target);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  async function load() {
    const [p, w, s, r, previewMode] = await Promise.all([
      premiumApi<Subscription>("/api/account/plan"),
      premiumApi<{ watches: Watch[] }>("/api/account/watches"),
      premiumApi<{ sources: Source[] }>("/api/account/custom-sources"),
      premiumApi<{ results: Match[] }>("/api/account/custom-results?page=" + page),
      import.meta.env.DEV
        ? premiumApi<{ live: boolean; sampleSourceIds?: string[] }>(
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
        if (active) setError((e as Error).message);
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
    const r = await premiumApi<{
      status: string;
      result: unknown;
      error?: { message: string };
    }>("/api/account/custom-jobs/" + encodeURIComponent(job));
    setJobStatus(r.status);
    if (r.status === "completed") {
      const parsed = watchConditionsSchema.safeParse(r.result);
      if (!parsed.success) {
        setJob(null);
        setInterpretKey(null);
        throw new Error(
          "Trợ lý chưa trả về bộ điều kiện hợp lệ. Bạn có thể bấm Thử lại hoặc điền từ khóa thủ công.",
        );
      }
      setDraft((d) => (d ? { ...d, conditions: parsed.data } : d));
      setPreview(true);
      setConfirmed(false);
      setJob(null);
      setInterpretKey(null);
      setNotice(
        "Đã đề xuất điều kiện. Hãy kiểm tra và xác nhận trước khi lưu.",
      );
    } else if (r.status === "failed" || r.status === "cancelled") {
      setJob(null);
      setInterpretKey(null);
      throw new Error(
        r.error?.message ?? "Không xử lý được; hãy nhập điều kiện thủ công.",
      );
    }
  }

  async function cancelInterpret() {
    const activeJob = job;
    setJob(null);
    setInterpretKey(null);
    setJobStatus("");
    if (activeJob) {
      await cancelCustomJob(activeJob);
    }
    setNotice("Đã dừng chờ trợ lý. Bạn có thể nhập điều kiện thủ công hoặc thử lại.");
  }

  // Automatic background polling while AI condition suggestion is running.
  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    let inFlight = false;
    let attempts = 0;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (cancelled || document.hidden || inFlight) return;
      if (++attempts > 45) {
        window.clearInterval(timer);
        if (!cancelled) {
          setJob(null);
          setInterpretKey(null);
          setError(
            "Quá thời gian chờ phản hồi từ trợ lý AI. Bạn có thể bấm Gợi ý lại hoặc điền từ khóa thủ công.",
          );
        }
        return;
      }
      inFlight = true;
      void premiumApi<{
        status: string;
        result: unknown;
        error?: { message: string };
      }>(
        "/api/account/custom-jobs/" + encodeURIComponent(job),
        undefined,
        "GET",
        undefined,
        controller.signal,
      )
        .then((r) => {
          if (cancelled) return;
          setJobStatus(r.status);
          if (r.status === "completed") {
            const parsed = watchConditionsSchema.safeParse(r.result);
            setJob(null);
            setInterpretKey(null);
            if (!parsed.success) {
              setError(
                "Trợ lý chưa trả về định dạng chuẩn. Bạn có thể thử lại hoặc nhập từ khóa thủ công.",
              );
              return;
            }
            setDraft((d) => (d ? { ...d, conditions: parsed.data } : d));
            setPreview(true);
            setConfirmed(false);
            setNotice(
              "Đã đề xuất điều kiện. Hãy kiểm tra và xác nhận trước khi lưu.",
            );
          } else if (r.status === "failed" || r.status === "cancelled") {
            setJob(null);
            setInterpretKey(null);
            setError(
              friendlyAiError(
                r.error?.message,
                "Không xử lý được; hãy nhập điều kiện thủ công.",
              ),
            );
          }
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }, 1500);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [job]);

  if (loading && !data) {
    return (
      <section className="account-card" role="status">
        Đang tải gói và nhu cầu…
      </section>
    );
  }
  if (!data) {
    return (
      <section className="account-card">
        <p role="alert">{error}</p>
        <button type="button" onClick={() => void action(load)}>
          Thử lại
        </button>
      </section>
    );
  }

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
      await premiumApi(
        editing
          ? "/api/account/watches/" + encodeURIComponent(editing)
          : "/api/account/watches",
        parsed.data,
        editing ? "PUT" : "POST",
      );
      setDraft(null);
      setNotice("Đã lưu theo dõi.");
    });
  }

  const hasSavedItems = results.some((r) => r.saved);
  const displayedResults = savedOnly ? results.filter((r) => r.saved) : results;

  return (
    <section className="custom-portal custom-member" ref={portalRef}>
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
            paymentConfig={data.paymentConfig}
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
                    await premiumApi(
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
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => edit()}
              >
                Tạo theo dõi
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => setView("plan")}
              >
                {data.signup?.status === "pending"
                  ? "Xem đăng ký"
                  : "Xem gói Premium"}
              </button>
            )}
            {plan.premium && watches.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(load)}
              >
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
                  type="button"
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
                    {w.enabled ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await premiumApi(
                              "/api/account/watches/" +
                                encodeURIComponent(w.id),
                              { enabled: false },
                              "PATCH",
                            );
                          })
                        }
                      >
                        Tạm dừng
                      </button>
                    ) : (
                      plan.premium && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await premiumApi(
                                "/api/account/watches/" +
                                  encodeURIComponent(w.id),
                                { enabled: true },
                                "PATCH",
                              );
                            })
                          }
                        >
                          Bật lại
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Xóa nhu cầu khỏi danh sách và dừng theo dõi?",
                          )
                        ) {
                          void action(async () => {
                            await premiumApi(
                              "/api/account/watches/" +
                                encodeURIComponent(w.id),
                              {},
                              "DELETE",
                            );
                          });
                        }
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
          <form onSubmit={(e) => void submit(e)} noValidate>
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
                        const r = await premiumApi<{ runId: string }>(
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
                  <div className="ai-progress-card" role="status" aria-live="polite">
                    <div className="ai-progress-bar" aria-hidden="true">
                      <span />
                    </div>
                    <div className="ai-progress-row">
                      <span>
                        Trợ lý{" "}
                        {jobStatus === "queued"
                          ? "đang chờ xử lý trong hàng đợi…"
                          : "đang phân tích mô tả và chuẩn bị điều kiện…"}
                      </span>
                      <div className="custom-buttons">
                        <button type="button" onClick={() => void action(checkJob)}>
                          Kiểm tra kết quả
                        </button>
                        <button
                          type="button"
                          onClick={() => void cancelInterpret()}
                        >
                          Dừng chờ
                        </button>
                      </div>
                    </div>
                  </div>
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
                      Đã gửi để duyệt. Khi được duyệt, tải lại nguồn rồi tích
                      chọn.
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
                      if (value !== "custom") {
                        change({ intervalMinutes: Number(value) });
                      }
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
                      value={
                        Number.isNaN(draft.intervalMinutes)
                          ? ""
                          : draft.intervalMinutes
                      }
                      onChange={(e) =>
                        change({
                          intervalMinutes:
                            e.target.value === ""
                              ? Number.NaN
                              : Number(e.target.value),
                        })
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
                        value={
                          Number.isNaN(draft.lookbackDays)
                            ? ""
                            : draft.lookbackDays
                        }
                        onChange={(e) =>
                          change({
                            lookbackDays:
                              e.target.value === ""
                                ? Number.NaN
                                : Number(e.target.value),
                          })
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
                  type="submit"
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
            <div className="custom-buttons">
              {(hasSavedItems || savedOnly) && (
                <button
                  type="button"
                  aria-pressed={savedOnly}
                  onClick={() => setSavedOnly((v) => !v)}
                >
                  {savedOnly ? "Hiện tất cả" : "Đã lưu"}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(load)}
              >
                Cập nhật kết quả
              </button>
            </div>
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
            {displayedResults.map((r) => (
              <li key={r.watch_id + r.article_id}>
                <h3>
                  <ExternalLink href={r.url}>{r.title}</ExternalLink>
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
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await premiumApi(
                          `/api/account/custom-results/${encodeURIComponent(r.watch_id)}/${encodeURIComponent(r.article_id)}`,
                          { saved: !r.saved, hidden: r.hidden },
                          "PATCH",
                        );
                      })
                    }
                  >
                    {r.saved ? "Bỏ lưu" : "Lưu"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await premiumApi(
                          `/api/account/custom-results/${encodeURIComponent(r.watch_id)}/${encodeURIComponent(r.article_id)}`,
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
                type="button"
                disabled={page === 1 || busy}
                onClick={() => setPage((p) => p - 1)}
              >
                Trang trước
              </button>
              <span>Trang {page}</span>
              <button
                type="button"
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
      await premiumApi("/api/account/custom-sources", {
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
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <h2 id="source-proposal-title">Thêm nguồn RSS</h2>
      <p id="source-proposal-help">
        Dán đường dẫn RSS hoặc Atom. Quản trị viên sẽ kiểm tra và duyệt nguồn.
      </p>
      <form onSubmit={(e) => void send(e)}>
        <fieldset disabled={sending}>
          <label>
            Tên nguồn <input name="name" required maxLength={100} />
          </label>
          <label>
            Đường dẫn RSS hoặc Atom
            <input name="url" type="url" required maxLength={2000} />
          </label>
          {error && (
            <p className="status error" role="alert">
              {error}
            </p>
          )}
          <div className="custom-buttons">
            <button type="submit" className="primary">
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
  paymentConfig,
  email,
  busy,
  onAction,
}: {
  signup: Subscription["signup"];
  offer?: Subscription["premiumOffer"];
  paymentConfig?: PaymentConfig;
  email: string;
  busy: boolean;
  onAction: (work: () => Promise<void>) => Promise<void>;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const priceText = paymentConfig?.priceText?.trim() || "20.000 ₫";
  const bankName = paymentConfig?.bankName?.trim() || "Agribank";
  const validatedExternalQr = safeExternalHref(paymentConfig?.qrUrl);
  const safeRemoteQr =
    validatedExternalQr && validatedExternalQr.startsWith("https://")
      ? validatedExternalQr
      : null;
  const qrSrc = safeRemoteQr ?? placeholderQr;
  const accountNumber = paymentConfig?.accountNumber?.trim() || "";

  async function copyText(value: string, successLabel: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(successLabel);
    } catch {
      setCopyStatus("Hãy chọn và sao chép thủ công ở trên.");
    }
  }

  const payment = (
    <div className="custom-payment">
      <div>
        <h3>Chuyển khoản để đăng ký</h3>
        <strong className="custom-payment-amount">{priceText}</strong>
        {paymentConfig?.accountNumber && (
          <p className="custom-bank-details">
            Ngân hàng: <strong>{bankName}</strong> · STK:{" "}
            <strong>{paymentConfig.accountNumber}</strong>
            {paymentConfig.accountName ? ` (${paymentConfig.accountName})` : ""}
          </p>
        )}
        <p>Dùng email đăng nhập làm nội dung chuyển khoản.</p>
        <strong className="custom-payment-email">{email}</strong>
        <div className="custom-buttons">
          <button
            type="button"
            onClick={() => void copyText(email, "Đã sao chép email.")}
          >
            Sao chép email
          </button>
          {accountNumber && (
            <button
              type="button"
              onClick={() =>
                void copyText(accountNumber, "Đã sao chép số tài khoản.")
              }
            >
              Sao chép STK
            </button>
          )}
        </div>
        {copyStatus && <p role="status">{copyStatus}</p>}
      </div>
      <a
        href={qrSrc}
        {...(safeRemoteQr
          ? { target: "_blank", rel: "noopener noreferrer" }
          : { download: "ma-qr-premium" })}
        className="custom-payment-qr"
        aria-label={"Tải mã QR chuyển khoản " + bankName}
      >
        <img
          src={qrSrc}
          alt={"Mã QR chuyển khoản " + bankName}
          width={520}
          height={520}
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
            <p>
              Quản trị viên sẽ đối chiếu khoản chuyển trước khi kích hoạt
              Premium.
            </p>
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
                await premiumApi("/api/account/premium-request", {
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
              <button type="submit" className="primary">
                {busy ? "Đang gửi…" : "Đã chuyển khoản"}
              </button>
            </fieldset>
          </form>
        </>
      )}
    </div>
  );
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

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
      const job = await premiumApi<{
        status: string;
        result: T | null;
        error?: { message: string };
      }>(
        "/api/account/custom-jobs/" + encodeURIComponent(id),
        undefined,
        "GET",
        undefined,
        signal,
      );
      if (job.status === "completed" && job.result) return job.result;
      if (job.status !== "queued" && job.status !== "running") {
        request.current = null;
        throw new Error(job.error?.message ?? "Chưa nhận được kết quả.");
      }
      await abortableSleep(1000, signal);
    }
    throw new Error("Yêu cầu vẫn đang xử lý. Bấm Tiếp tục để kiểm tra.");
  }

  async function cancelWebBrief() {
    const inFlightJob =
      request.current?.summaryId ?? request.current?.searchId ?? null;
    request.current = null;
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setPending(false);
    setMessage("Đã dừng chờ kết quả tìm kiếm.");
    if (inFlightJob) {
      await cancelCustomJob(inFlightJob);
    }
  }

  async function start(event?: FormEvent) {
    event?.preventDefault();
    const description = query.trim();
    if (description.length < 5) return;
    // Cancel any stale in-flight request before launching a fresh one.
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      if (livePreview) {
        setMessage("Đang tìm nguồn thật và tổng hợp…");
        const brief = await premiumApi<TopicBrief>(
          "/api/account/custom-web-preview",
          { description },
          "POST",
          undefined,
          controller.signal,
        );
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
        setMessage("Đang tìm các nguồn tin liên quan trên web…");
        job.searchId ??= (
          await premiumApi<{ runId: string }>(
            "/api/account/custom-web-brief",
            { description: job.query },
            "POST",
            job.searchKey,
            controller.signal,
          )
        ).runId;
        const search = await waitForJob<DiscoveryResult>(
          job.searchId,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        if (!search.candidates?.length) {
          request.current = null;
          setMessage(
            "Chưa tìm được nguồn phù hợp. Thử nêu rõ địa điểm hoặc thời gian.",
          );
          return;
        }
        setMessage("Đã tìm thấy nguồn tin, đang biên tập bản tóm tắt…");
        job.summaryId = (
          await premiumApi<{ runId: string }>(
            "/api/account/custom-web-brief",
            { searchRunId: job.searchId },
            "POST",
            job.summaryKey,
            controller.signal,
          )
        ).runId;
      }
      setMessage("Đang biên tập bản tóm tắt tiếng Việt…");
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
        setError(friendlyAiError(failure));
        setMessage("");
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
      }
      if (!controller.signal.aborted) {
        setPending(request.current !== null);
        setBusy(false);
      }
    }
  }

  return (
    <form className="custom-web-form" onSubmit={(e) => void start(e)}>
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
          Câu hỏi được gửi tới dịch vụ tìm kiếm. AI đọc các trích đoạn công khai
          từ web. Không nhập thông tin cá nhân nhạy cảm.
        </small>
        <div className="custom-buttons">
          <button
            className="primary"
            type="submit"
            disabled={busy || query.trim().length < 5}
          >
            {busy ? "Đang xử lý…" : pending ? "Tiếp tục" : "Tìm và tổng hợp"}
          </button>
          {busy && (
            <button type="button" onClick={() => void cancelWebBrief()}>
              Dừng chờ
            </button>
          )}
          {!busy && error && query.trim().length >= 5 && (
            <button
              type="button"
              onClick={() => {
                request.current = null;
                void start();
              }}
            >
              Thử lại
            </button>
          )}
        </div>
        {busy && message && (
          <div className="ai-progress-card" role="status" aria-live="polite">
            <div className="ai-progress-bar" aria-hidden="true">
              <span />
            </div>
            <span>{message}</span>
          </div>
        )}
        {!busy && message && <p role="status">{message}</p>}
        {error && (
          <p className="status error" role="alert">
            {error}
          </p>
        )}
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
            <ExternalLink href={article.url}>{article.title}</ExternalLink>
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

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    let inFlight = false;
    let attempts = 0;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (cancelled || document.hidden || inFlight) return;
      if (++attempts > 40) {
        window.clearInterval(timer);
        if (!cancelled) {
          setJob(null);
          requestKey.current = null;
          setError(
            "Quá thời gian chờ tổng hợp. Bạn có thể bấm Thử lại hoặc đọc trực tiếp danh sách tin.",
          );
        }
        return;
      }
      inFlight = true;
      void premiumApi<{
        status: string;
        result: TopicBrief | null;
        error?: { message: string };
      }>(
        "/api/account/custom-jobs/" + encodeURIComponent(job),
        undefined,
        "GET",
        undefined,
        controller.signal,
      )
        .then((reply) => {
          if (cancelled) return;
          if (
            reply.status === "completed" ||
            reply.status === "failed" ||
            reply.status === "cancelled"
          ) {
            setJob(null);
            requestKey.current = null;
            if (!reply.result) {
              setError(
                friendlyAiError(
                  reply.error?.message,
                  "Chưa tổng hợp được thông tin.",
                ),
              );
            } else {
              setResult(reply.result);
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }, 1800);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [job]);

  async function cancelSummary() {
    const activeJob = job;
    setJob(null);
    requestKey.current = null;
    if (activeJob) {
      await cancelCustomJob(activeJob);
    }
  }

  async function summarize() {
    setBusy(true);
    setError("");
    try {
      if (!job) {
        requestKey.current ??= crypto.randomUUID();
        const request = await premiumApi<{ runId: string }>(
          "/api/account/custom-summary/" + encodeURIComponent(watchId),
          {},
          "POST",
          requestKey.current,
        );
        setJob(request.runId);
      } else {
        const reply = await premiumApi<{
          status: string;
          result: TopicBrief | null;
          error?: { message: string };
        }>("/api/account/custom-jobs/" + encodeURIComponent(job));
        if (
          reply.status === "completed" ||
          reply.status === "failed" ||
          reply.status === "cancelled"
        ) {
          setJob(null);
          requestKey.current = null;
          if (!reply.result) {
            throw new Error(
              reply.error?.message ?? "Chưa tổng hợp được thông tin.",
            );
          }
          setResult(reply.result);
        }
      }
    } catch (failure) {
      setError(friendlyAiError(failure, "Chưa tổng hợp được thông tin."));
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
              : error
                ? "Thử tổng hợp lại"
                : "Tạo bản tổng hợp"}
        </button>
        {job && (
          <button type="button" onClick={() => void cancelSummary()}>
            Dừng chờ
          </button>
        )}
      </div>
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
      {job && (
        <div className="ai-progress-card" role="status" aria-live="polite">
          <div className="ai-progress-bar" aria-hidden="true">
            <span />
          </div>
          <span>Đang tổng hợp các tin phù hợp bằng AI…</span>
        </div>
      )}
      {result && <BriefResult result={result} />}
    </div>
  );
}

function Enrichment({
  articleId,
}: {
  articleId: string;
  onAction?: (work: () => Promise<void>) => Promise<void>;
}) {
  const [job, setJob] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    summary: string;
    deadline: string | null;
    evidence: string[];
  } | null>(null);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    let inFlight = false;
    let attempts = 0;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (cancelled || document.hidden || inFlight) return;
      if (++attempts > 40) {
        window.clearInterval(timer);
        if (!cancelled) {
          setJob(null);
          setKey(null);
          setError("Quá thời gian chờ trích xuất. Bạn có thể bấm Thử lại.");
        }
        return;
      }
      inFlight = true;
      void premiumApi<{
        status: string;
        result: typeof result;
        error?: { message: string };
      }>(
        "/api/account/custom-jobs/" + encodeURIComponent(job),
        undefined,
        "GET",
        undefined,
        controller.signal,
      )
        .then((r) => {
          if (cancelled) return;
          if (r.status === "completed") {
            setResult(r.result);
            setJob(null);
            setKey(null);
          } else if (r.status === "failed" || r.status === "cancelled") {
            setJob(null);
            setKey(null);
            setError(
              friendlyAiError(r.error?.message, "Không trích xuất được."),
            );
          }
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }, 1800);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [job]);

  async function startEnrich() {
    setBusy(true);
    setError("");
    try {
      const requestKey = key ?? crypto.randomUUID();
      setKey(requestKey);
      const r = await premiumApi<{
        runId?: string;
        result?: typeof result;
      }>(
        "/api/account/custom-enrich/" + encodeURIComponent(articleId),
        {},
        "POST",
        requestKey,
      );
      if (r.result) setResult(r.result);
      else setJob(r.runId ?? null);
    } catch (e) {
      setError(friendlyAiError(e, "Không trích xuất được chi tiết."));
    } finally {
      setBusy(false);
    }
  }

  async function checkEnrich() {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      const r = await premiumApi<{
        status: string;
        result: typeof result;
        error?: { message: string };
      }>("/api/account/custom-jobs/" + encodeURIComponent(job));
      if (r.status === "completed") {
        setResult(r.result);
        setJob(null);
        setKey(null);
      } else if (r.status === "failed" || r.status === "cancelled") {
        setJob(null);
        setKey(null);
        setError(friendlyAiError(r.error?.message, "Không trích xuất được."));
      }
    } catch (e) {
      setError(friendlyAiError(e, "Không kiểm tra được trạng thái."));
    } finally {
      setBusy(false);
    }
  }

  async function cancelEnrich() {
    const activeJob = job;
    setJob(null);
    setKey(null);
    if (activeJob) {
      await cancelCustomJob(activeJob);
    }
  }

  return (
    <div>
      {!job && !result && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void startEnrich()}
        >
          {busy
            ? "Đang gửi yêu cầu…"
            : error
              ? "Thử trích xuất lại"
              : "Trích xuất thông tin bằng trợ lý"}
        </button>
      )}
      {job && (
        <div className="ai-progress-card" role="status" aria-live="polite">
          <div className="ai-progress-bar" aria-hidden="true">
            <span />
          </div>
          <div className="ai-progress-row">
            <span>Trợ lý đang đọc và trích xuất thông tin…</span>
            <div className="custom-buttons">
              <button
                type="button"
                disabled={busy}
                onClick={() => void checkEnrich()}
              >
                Kiểm tra kết quả
              </button>
              <button type="button" onClick={() => void cancelEnrich()}>
                Dừng chờ
              </button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="ai-enrichment-result">
          <p>{result.summary}</p>
          <p>
            <strong>Hạn được trích xuất:</strong>{" "}
            {result.deadline ?? "Chưa xác định"} · Kiểm tra đối chiếu tại nguồn.
          </p>
          {result.evidence.map((s, i) => (
            <blockquote key={i}>{s}</blockquote>
          ))}
        </div>
      )}
    </div>
  );
}
