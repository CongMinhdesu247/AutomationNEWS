import { useEffect, useState, type FormEvent } from "react";
import type { AiControl } from "@hub/contracts";
import { Icon } from "../Icons";
import { isSampleUrl } from "../sample-url";
import { ExternalLink } from "../components/ExternalLink";
import {
  auditActionLabels,
  premiumApi,
  sourceStatusLabels,
  usageKindLabels,
  when,
  type AdminData,
  type AdminSource,
  type AiData,
  type SourceStatus,
} from "./types";

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
      const result = await premiumApi<{ source: AdminSource }>(
        "/api/admin/custom-sources/" + encodeURIComponent(source.id),
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
          <ExternalLink href={source.url}>{source.url}</ExternalLink>
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
  const [query, setQuery] = useState("");
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
      const result = await premiumApi<{ id: string | null }>(
        "/api/admin/custom-sources",
        {
          name: fields.get("name"),
          url: fields.get("url"),
        },
      );
      if (!result.id) {
        throw new Error("Địa chỉ này đã có trong danh sách nguồn.");
      }
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

  const needle = query.trim().toLowerCase();
  const visibleSources = sources.filter(
    (source) =>
      (filter === "all" || source.status === filter) &&
      (!needle ||
        source.name.toLowerCase().includes(needle) ||
        source.url.toLowerCase().includes(needle)),
  );

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
        <form onSubmit={(e) => void addSource(e)} className="custom-admin-add-source">
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
            <button className="primary" type="submit">
              {adding ? "Đang thêm…" : "Thêm nguồn"}
            </button>
          </fieldset>
        </form>
      </details>

      <div className="custom-admin-toolbar">
        <div
          className="custom-admin-filters"
          role="group"
          aria-label="Lọc nguồn theo trạng thái"
        >
          {(["all", "pending", "approved", "rejected"] as const).map(
            (status) => (
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
                    : sources.filter((source) => source.status === status)
                        .length}
                </span>
              </button>
            ),
          )}
        </div>
        {sources.length > 4 && (
          <input
            type="search"
            className="custom-admin-search"
            placeholder="Tìm theo tên hoặc tên miền…"
            aria-label="Tìm nguồn tin"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>

      {notice && (
        <p className="status success" role="status">
          {notice}
        </p>
      )}
      {visibleSources.length === 0 && (
        <p>Chưa có nguồn nào khớp bộ lọc hiện tại.</p>
      )}
      <ul className="custom-admin-source-list">
        {visibleSources.map((source) => (
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
            value={Number.isNaN(config[key]) ? "" : config[key]}
            onChange={(event) =>
              onChange({
                ...config,
                [key]:
                  event.target.value === ""
                    ? min
                    : Number(event.target.value),
              })
            }
          />
        </label>
      ))}
    </div>
  );
}

export default function PremiumAdmin() {
  const [data, setData] = useState<AdminData | null>(null);
  const [ai, setAi] = useState<AiData | null>(null);
  const [config, setConfig] = useState<AiControl | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"accounts" | "sources" | "ai">("accounts");
  const [livePreview, setLivePreview] = useState(false);

  async function load() {
    const [d, a, preview] = await Promise.all([
      premiumApi<AdminData>("/api/admin/premium"),
      premiumApi<AiData>("/api/admin/custom-ai"),
      import.meta.env.DEV
        ? premiumApi<{ live: boolean }>("/api/account/custom-web-preview").catch(
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
    void load().catch((e) => setError((e as Error).message));
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
        <button type="button" disabled={busy} onClick={() => void action(load)}>
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
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="status success" role="status">
          {notice}
        </p>
      )}
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
              <p>
                Đối chiếu khoản chuyển khoản và email đăng nhập trước khi duyệt.
              </p>
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
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await premiumApi(
                            "/api/admin/premium/" + encodeURIComponent(r.user_id),
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
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await premiumApi(
                            "/api/admin/premium-requests/" +
                              encodeURIComponent(r.user_id) +
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
              const rawExpires = String(f.get("expires") ?? "").trim();
              const parsedExpires = rawExpires ? new Date(rawExpires) : null;
              if (parsedExpires && Number.isNaN(parsedExpires.getTime())) {
                setError("Ngày giờ hết hạn không hợp lệ.");
                return;
              }
              void action(async () => {
                await premiumApi(
                  "/api/admin/premium/" +
                    encodeURIComponent(String(f.get("user") ?? "")),
                  {
                    plan: f.get("plan"),
                    expiresAt: parsedExpires
                      ? parsedExpires.toISOString()
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
              <button type="submit" className="primary">
                Áp dụng gói
              </button>
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
                    await premiumApi(
                      "/api/admin/plans/" + encodeURIComponent(p.id),
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
                  <legend>
                    Hạn mức gói {p.id === "premium" ? "Premium" : "Free"}
                  </legend>
                  <div className="account-grid">
                    <label>
                      Theo dõi hoạt động tối đa
                      <input
                        name="active"
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={p.active_watches}
                      />
                    </label>
                    <label>
                      Tìm kiếm web / tháng
                      <input
                        name="discovery"
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={p.discovery_month}
                      />
                    </label>
                    <label>
                      Lượt trợ lý AI / tháng
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
                  <button type="submit">Lưu hạn mức</button>
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
              setAi(await premiumApi<AiData>("/api/admin/custom-ai"))
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
                  await premiumApi("/api/admin/custom-ai", config, "PUT");
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
                <button type="submit" className="primary">
                  Lưu cấu hình AI
                </button>
              </fieldset>
            </form>
          </details>

          <details className="custom-disclosure">
            <summary>Mức sử dụng và lỗi tác vụ</summary>
            <h3>Mức sử dụng gần đây</h3>
            <p>
              Trạng thái chưa xác định giữ nguyên phần ngân sách đã đặt chỗ để
              đối soát; không coi là miễn phí.
            </p>
            {ai?.usage.length ? (
              <ul className="admin-audit-list">
                {ai.usage.map((u) => (
                  <li key={u.id}>
                    <strong>{usageKindLabels[u.kind] ?? u.kind}</strong> ·{" "}
                    {u.provider}/{u.model} · Trạng thái: {u.status}
                    {u.error_code ? ` (${u.error_code})` : ""} · Ước tính{" "}
                    {u.estimated_micros ?? "chưa biết"} µUSD (đặt chỗ{" "}
                    {u.reserved_micros} µUSD) · Token vào/ra:{" "}
                    {u.input_tokens ?? "—"}/{u.output_tokens ?? "—"} · Tìm kiếm:{" "}
                    {u.search_units ?? "—"} · Bảng giá: {u.pricing_version}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Chưa phát sinh lượt gọi AI hoặc tìm kiếm.</p>
            )}
            <h3>Tác vụ lỗi</h3>
            {ai?.jobs.length ? (
              <ul className="admin-audit-list">
                {ai.jobs.map((j) => (
                  <li key={j.run_id}>
                    <strong>{usageKindLabels[j.kind] ?? j.kind}</strong> ·{" "}
                    {j.error?.message ?? "Lỗi chưa xác định"}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Không có tác vụ lỗi.</p>
            )}
          </details>
        </section>
      )}

      {data && (
        <details
          className="account-card custom-source-tools"
          hidden={tab !== "accounts"}
        >
          <summary>Nhật ký quản trị ({data.audits.length})</summary>
          {data.audits.length ? (
            <ul className="admin-audit-list">
              {data.audits.map((a) => (
                <li key={a.id}>
                  <span>{when(a.created_at)}</span> ·{" "}
                  <strong>{auditActionLabels[a.action] ?? a.action}</strong> ·{" "}
                  <small>{a.subject_id ?? "Toàn hệ thống"}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Chưa có bản ghi quản trị.</p>
          )}
        </details>
      )}
    </section>
  );
}
