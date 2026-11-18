import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatDateTime,
  hasEnabledSources,
  normalizeUrl,
  safeExternalHref,
  type BookmarkItem,
  type Settings,
} from "@hub/contracts";
import DigestDashboard, { type ToggleBookmarkPayload } from "./DigestDashboard";
import RunDashboard from "./RunDashboard";
import { Icon } from "./Icons";
import {
  apiRequest,
  clearAccountSessionStorage,
  HttpClientError,
  type Account,
  type AuthConfig,
} from "./lib/api-client";
import { lazyWithRetry } from "./lib/format";
import { AccountBrand, AuthPortal } from "./components/AuthPortal";
import { PreferencesView } from "./components/PreferencesView";
import { PasswordView } from "./components/PasswordView";
import { UsersAdminView } from "./components/UsersAdminView";
import { BookmarksView } from "./features/bookmarks/BookmarksView";

const AdminApp = lazyWithRetry(() => import("./App"));
const PremiumPortal = lazyWithRetry(() => import("./PremiumPortal"));

function isLegacyAdminHash(hash: string): boolean {
  return (
    hash === "#/admin" ||
    hash === "#/family" ||
    hash === "#/automation" ||
    hash.startsWith("#/settings/")
  );
}

function pageTitleForHash(hash: string, authenticated: boolean): string {
  if (!authenticated) return "Đăng nhập · Bản tin mỗi sáng";
  if (hash === "#/bookmarks") return "Danh sách đọc sau · Bản tin mỗi sáng";
  if (hash === "#/custom") return "Gói & theo dõi · Bản tin mỗi sáng";
  if (hash === "#/premium-admin") return "Quản trị Premium & AI · Bản tin mỗi sáng";
  if (hash === "#/preferences") return "Tùy chọn bản tin · Bản tin mỗi sáng";
  if (hash === "#/password") return "Đổi mật khẩu · Bản tin mỗi sáng";
  if (hash === "#/users") return "Quản lý thành viên · Bản tin mỗi sáng";
  if (hash.startsWith("#/runs")) return "Tiến độ xử lý · Bản tin mỗi sáng";
  if (isLegacyAdminHash(hash)) return "Quản trị hệ thống · Bản tin mỗi sáng";
  return "Bản tin của tôi · Bản tin mỗi sáng";
}

function canonicalUrlKey(raw: string): string {
  const safe = safeExternalHref(raw);
  if (!safe) return raw.trim();
  try {
    return normalizeUrl(safe);
  } catch {
    return safe;
  }
}

function MemberGreeting() {
  const [premium, setPremium] = useState<boolean | null>(null);
  const lastFetchedAt = useRef(0);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      const now = Date.now();
      if (now - lastFetchedAt.current < 15000) return;
      lastFetchedAt.current = now;
      void apiRequest<{ plan: { premium: boolean } }>("/api/account/plan")
        .then(({ plan }) => {
          if (active) setPremium(plan.premium);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (premium === null) return <h2>Chào bạn</h2>;
  return <h2>{premium ? "Chào Thành viên Premium" : "Chào Thành viên"}</h2>;
}

export default function AccountApp() {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [hash, setHash] = useState(window.location.hash);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const isRunHistory = hash === "#/runs" || hash === "#/runs/";

  useEffect(() => {
    const change = () => setHash(window.location.hash);
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);

  // Automatically clear stale session when any authenticated API returns 401.
  useEffect(() => {
    const onUnauthorized = () => {
      clearAccountSessionStorage();
      setAccount(null);
      setBookmarks([]);
    };
    window.addEventListener("hub:unauthorized", onUnauthorized);
    return () => window.removeEventListener("hub:unauthorized", onUnauthorized);
  }, []);

  // Close <details class="account-menu"> on Escape or click outside.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menuRef.current?.open) {
        menuRef.current.open = false;
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (
        menuRef.current?.open &&
        e.target instanceof Node &&
        !menuRef.current.contains(e.target)
      ) {
        menuRef.current.open = false;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  // Sync dynamic document title, overscroll background, and mobile browser theme-color bar.
  useEffect(() => {
    document.title = pageTitleForHash(hash, Boolean(account));
    if (account) {
      const isDark = account.theme === "dark";
      document.documentElement.style.backgroundColor = isDark
        ? "#12211c"
        : "#f3f7f6";
      document.documentElement.style.colorScheme = isDark ? "dark" : "light";
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.setAttribute("content", isDark ? "#12211c" : "#f3f7f6");
      }
    }
  }, [hash, account]);

  useEffect(() => {
    if (account?.user.role === "member" && isRunHistory) {
      window.location.replace("#/digests");
    }
  }, [account?.user.role, isRunHistory]);

  useEffect(() => {
    let active = true;
    void apiRequest<AuthConfig>("/api/auth/config", {
      timeoutMs: 10000,
      notifyUnauthorized: false,
    })
      .then(async (value) => {
        if (!active) return;
        setConfig(value);
        if (value.enabled) {
          try {
            const data = await apiRequest<Account>("/api/account", {
              timeoutMs: 10000,
              notifyUnauthorized: false,
            });
            if (active) setAccount(data);
          } catch (err) {
            if (err instanceof HttpClientError && err.status === 401) {
              return;
            }
            throw new Error("Chưa tải được tài khoản. Hãy tải lại trang.");
          }
        }
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      })
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Load saved reading list when authenticated.
  useEffect(() => {
    if (!account) {
      setBookmarks([]);
      return;
    }
    let active = true;
    void apiRequest<{ items: BookmarkItem[] }>("/api/account/bookmarks", {
      timeoutMs: 12000,
    })
      .then((res) => {
        if (active) setBookmarks(res.items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [account?.user.id]);

  const bookmarkedUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of bookmarks) {
      map.set(canonicalUrlKey(item.url), item.id);
    }
    return map;
  }, [bookmarks]);

  const completedTaskIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of account?.settings.tasks?.items ?? []) {
      if (item.done) set.add(item.id);
    }
    return set;
  }, [account?.settings.tasks?.items]);

  const handleToggleBookmark = useCallback(
    async (payload: ToggleBookmarkPayload) => {
      const key = canonicalUrlKey(payload.url);
      const existingId = bookmarkedUrls.get(key);
      if (existingId) {
        await apiRequest(
          `/api/account/bookmarks/${encodeURIComponent(existingId)}`,
          { method: "DELETE" },
        );
        setBookmarks((curr) => curr.filter((b) => b.id !== existingId));
        showToast("Đã bỏ lưu khỏi danh sách đọc sau.");
      } else {
        const res = await apiRequest<{ bookmark: BookmarkItem }>(
          "/api/account/bookmarks",
          {
            method: "POST",
            body: payload,
          },
        );
        setBookmarks((curr) => [
          res.bookmark,
          ...curr.filter((b) => b.id !== res.bookmark.id),
        ]);
        showToast("Đã lưu vào danh sách đọc sau.");
      }
    },
    [bookmarkedUrls, showToast],
  );

  const handleRemoveBookmark = useCallback(
    async (id: string) => {
      await apiRequest(`/api/account/bookmarks/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setBookmarks((curr) => curr.filter((b) => b.id !== id));
      showToast("Đã xóa mục khỏi danh sách đọc sau.");
    },
    [showToast],
  );

  const handleToggleTask = useCallback(
    async (taskId: string, done: boolean) => {
      const res = await apiRequest<{
        updated: boolean;
        done: boolean;
        revision: number;
        settings: Settings;
      }>(`/api/account/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: { done },
      });
      setAccount((curr) =>
        curr
          ? {
              ...curr,
              settings: res.settings,
              revision: res.revision,
            }
          : curr,
      );
      showToast(done ? "Đã đánh dấu hoàn thành việc cần làm." : "Đã mở lại việc cần làm.");
    },
    [showToast],
  );

  if (booting) {
    return (
      <main className="account-shell account-booting">
        <div className="boot-spinner" aria-hidden="true" />
        <p role="status">Đang mở bản tin…</p>
      </main>
    );
  }

  if (!config) {
    return (
      <main className="account-shell account-error-boundary">
        <div className="account-card">
          <p role="alert" className="status error">
            {error}
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => window.location.reload()}
          >
            Thử lại
          </button>
        </div>
      </main>
    );
  }

  if (!config.enabled) {
    return (
      <Suspense fallback={<p role="status">Đang tải…</p>}>
        <AdminApp />
      </Suspense>
    );
  }

  if (!account) {
    return <AuthPortal config={config} onLogin={setAccount} />;
  }

  const isAdmin = account.user.role === "admin";
  const adminMode = isAdmin && isLegacyAdminHash(hash);
  const isRunDetail =
    hash.startsWith("#/runs/") && hash.length > "#/runs/".length;

  function endSession() {
    clearAccountSessionStorage();
    setAccount(null);
    setBookmarks([]);
    setError("");
    window.location.hash = "/digests";
  }

  async function logout() {
    try {
      await apiRequest("/api/auth/logout", { body: {} });
      endSession();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleQuickTheme() {
    if (!account) return;
    const prevTheme = account.theme;
    const nextTheme = prevTheme === "dark" ? "light" : "dark";
    setAccount((curr) => (curr ? { ...curr, theme: nextTheme } : curr));
    try {
      await apiRequest<{ theme: "light" | "dark" }>("/api/account/theme", {
        method: "PATCH",
        body: { theme: nextTheme },
      });
    } catch {
      setAccount((curr) => (curr ? { ...curr, theme: prevTheme } : curr));
    }
  }

  return (
    <div className={"account-root theme-" + account.theme}>
      <a className="skip-link" href="#account-main-content">
        Chuyển tới nội dung chính
      </a>
      <header className="account-header">
        <a className="account-brand" href="#/digests">
          <AccountBrand />
        </a>
        <div className="account-header-controls">
          <button
            type="button"
            className="theme-icon-button"
            aria-label={
              account.theme === "dark"
                ? "Chuyển sang giao diện sáng"
                : "Chuyển sang giao diện tối"
            }
            title={
              account.theme === "dark" ? "Giao diện sáng" : "Giao diện tối"
            }
            onClick={() => void toggleQuickTheme()}
          >
            <Icon name={account.theme === "dark" ? "sun" : "moon"} size={18} />
          </button>
          <details className="account-menu" ref={menuRef}>
            <summary aria-label={"Tài khoản của " + account.user.name}>
              <span className="account-avatar">
                {account.user.name
                  .trim()
                  .split(/\s+/)
                  .at(-1)
                  ?.slice(0, 1)
                  .toUpperCase()}
              </span>
              <span className="account-menu-name">{account.user.name}</span>
              <Icon name="chevron" size={16} />
            </summary>
            <div className="account-menu-panel">
              <strong>{account.user.name}</strong>
              <span>{account.user.email}</span>
              <a
                className="menu-panel-link"
                href="#/bookmarks"
                onClick={() => {
                  if (menuRef.current) menuRef.current.open = false;
                }}
              >
                <Icon name="bookmark" size={16} /> Đã lưu ({bookmarks.length})
              </a>
              <a
                className="menu-panel-link"
                href="#/password"
                onClick={() => {
                  if (menuRef.current) menuRef.current.open = false;
                }}
              >
                <Icon name="lock" size={16} /> Đổi mật khẩu
              </a>
              {isAdmin && (
                <div className="menu-admin-shortcuts">
                  <small>Quản trị nhanh</small>
                  <a
                    className="menu-panel-link"
                    href="#/premium-admin"
                    onClick={() => {
                      if (menuRef.current) menuRef.current.open = false;
                    }}
                  >
                    <Icon name="shield" size={15} /> Premium &amp; AI
                  </a>
                  <a
                    className="menu-panel-link"
                    href="#/users"
                    onClick={() => {
                      if (menuRef.current) menuRef.current.open = false;
                    }}
                  >
                    <Icon name="user" size={15} /> Thành viên
                  </a>
                  <a
                    className="menu-panel-link"
                    href="#/runs"
                    onClick={() => {
                      if (menuRef.current) menuRef.current.open = false;
                    }}
                  >
                    <Icon name="activity" size={15} /> Lịch sử xử lý
                  </a>
                  <a
                    className="menu-panel-link"
                    href="#/admin"
                    onClick={() => {
                      if (menuRef.current) menuRef.current.open = false;
                    }}
                  >
                    <Icon name="settings" size={15} /> Quản trị hệ thống
                  </a>
                </div>
              )}
              <button type="button" onClick={() => void logout()}>
                <Icon name="logout" size={18} />
                Đăng xuất
              </button>
            </div>
          </details>
        </div>
      </header>

      <div className="account-shell">
        <nav
          className={
            isAdmin ? "account-nav account-nav-admin" : "account-nav"
          }
          aria-label="Điều hướng tài khoản"
        >
          <a
            href="#/digests"
            aria-current={
              (!adminMode && (!hash || hash.startsWith("#/digests"))) ||
              (!isAdmin && isRunDetail)
                ? "page"
                : undefined
            }
          >
            <Icon name="brief" />
            <span>Bản tin của tôi</span>
          </a>
          <a
            href="#/bookmarks"
            aria-current={hash === "#/bookmarks" ? "page" : undefined}
          >
            <Icon name="bookmark" filled={bookmarks.length > 0} />
            <span>
              Đã lưu{bookmarks.length > 0 ? ` (${bookmarks.length})` : ""}
            </span>
          </a>
          <a
            href="#/custom"
            aria-current={hash === "#/custom" ? "page" : undefined}
          >
            <Icon name="sparkle" />
            <span>Gói &amp; theo dõi</span>
          </a>
          <a
            href="#/preferences"
            aria-current={hash === "#/preferences" ? "page" : undefined}
          >
            <Icon name="settings" />
            <span>Tùy chọn bản tin</span>
          </a>
          {isAdmin && (
            <>
              <a
                href="#/premium-admin"
                className="desktop-admin-tab"
                aria-current={hash === "#/premium-admin" ? "page" : undefined}
              >
                <Icon name="shield" />
                <span>Premium &amp; AI</span>
              </a>
              <a
                href="#/runs"
                className="desktop-admin-tab"
                aria-current={hash.startsWith("#/runs") ? "page" : undefined}
              >
                <Icon name="activity" />
                <span>Lịch sử xử lý</span>
              </a>
              <a
                href="#/users"
                className="desktop-admin-tab"
                aria-current={hash === "#/users" ? "page" : undefined}
              >
                <Icon name="user" />
                <span>Thành viên</span>
              </a>
              <a
                href="#/admin"
                className="admin-hub-tab"
                aria-current={adminMode ? "page" : undefined}
              >
                <Icon name="settings" />
                <span>Quản trị hệ thống</span>
              </a>
            </>
          )}
        </nav>

        <main id="account-main-content">
          {error && (
            <p className="status error" role="alert">
              {error}
            </p>
          )}
          {adminMode ? (
            <Suspense fallback={<p role="status">Đang tải…</p>}>
              <AdminApp embedded />
            </Suspense>
          ) : hash === "#/bookmarks" ? (
            <BookmarksView
              items={bookmarks}
              timezone={account.settings.newsletter.timezone}
              onRemove={handleRemoveBookmark}
            />
          ) : hash === "#/custom" ||
            (hash === "#/premium-admin" && isAdmin) ? (
            <Suspense fallback={<p role="status">Đang tải…</p>}>
              <PremiumPortal
                key={hash}
                admin={hash === "#/premium-admin"}
                email={account.user.email}
              />
            </Suspense>
          ) : hash === "#/users" && isAdmin ? (
            <UsersAdminView />
          ) : hash === "#/password" ? (
            <PasswordView onLogout={endSession} />
          ) : hash === "#/preferences" ? (
            <PreferencesView
              key={account.user.id}
              account={account}
              onSaved={(next) => {
                setAccount(next);
                showToast("Đã lưu tùy chọn bản tin.");
              }}
            />
          ) : isRunDetail || (isAdmin && isRunHistory) ? (
            <RunDashboard
              hash={hash}
              listUrl="/api/account/runs"
              showDiagnostics={isAdmin}
            />
          ) : (
            <>
              {!hash.startsWith("#/digests/") && (
                <section className="account-welcome">
                  <div>
                    <p className="account-date">
                      {new Date().toLocaleDateString("vi-VN", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        timeZone: account.settings.newsletter.timezone,
                      })}
                    </p>
                    {isAdmin ? (
                      <h2>Chào {account.user.name}.</h2>
                    ) : (
                      <MemberGreeting key={account.user.id} />
                    )}
                    <div className="account-interest-tags">
                      {account.settings.weather.location && (
                        <span>
                          <Icon name="sun" size={15} />
                          {account.settings.weather.location}
                        </span>
                      )}
                      {account.settings.rss.filter((f) => f.enabled).length >
                        0 && (
                        <span>
                          <Icon name="brief" size={15} />
                          {
                            account.settings.rss.filter((f) => f.enabled).length
                          }{" "}
                          nguồn tin
                        </span>
                      )}
                      {bookmarks.length > 0 && (
                        <a href="#/bookmarks" className="interest-tag-link">
                          <Icon name="bookmark" size={14} filled />
                          {bookmarks.length} đọc sau
                        </a>
                      )}
                    </div>
                  </div>
                  <a
                    href="#/preferences"
                    className="account-schedule-preview"
                    title="Chỉnh lịch nhận bản tin"
                  >
                    <span>
                      <Icon name="calendar" size={18} />
                      Lịch bản tin của bạn
                    </span>
                    <strong>
                      {account.nextRunAt
                        ? formatDateTime(
                            account.nextRunAt,
                            account.settings.newsletter.timezone,
                          )
                        : "Chưa đặt lịch nhận"}
                    </strong>
                  </a>
                </section>
              )}
              <DigestDashboard
                key={account.user.id}
                hash={hash}
                apiBase="/api/account"
                accountId={account.user.id}
                canCreate={hasEnabledSources(account.settings)}
                timezone={account.settings.newsletter.timezone}
                bookmarkedUrls={bookmarkedUrls}
                onToggleBookmark={handleToggleBookmark}
                completedTaskIds={completedTaskIds}
                onToggleTask={handleToggleTask}
              />
            </>
          )}
        </main>
      </div>

      {toast && (
        <div className="account-toast" role="status" aria-live="polite">
          <Icon name="check" size={16} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
