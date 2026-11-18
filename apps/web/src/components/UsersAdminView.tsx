import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTime } from "@hub/contracts";
import { Icon } from "../Icons";
import { apiRequest, type User } from "../lib/api-client";
import { relativeVi } from "../lib/format";

type AdminMember = User & { disabled: boolean; created_at?: string };

type SystemHealth = {
  checkedAt: string;
  dbPool: { total: number; idle: number; waiting: number };
  queue: {
    queued: number;
    leased: number;
    dead_letters: number;
    failed_24h: number;
  };
  users: { active_users: number; scheduled_users: number };
  schedulerLastCheckedAt: string | null;
};

export function UsersAdminView() {
  const [users, setUsers] = useState<AdminMember[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const [usersData, healthData] = await Promise.all([
      apiRequest<{ users: AdminMember[] }>("/api/admin/users"),
      apiRequest<SystemHealth>("/api/admin/system-health").catch(() => null),
    ]);
    setUsers(usersData.users);
    if (healthData) setHealth(healthData);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, [load]);

  async function refreshAll() {
    setRefreshing(true);
    setError("");
    try {
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function toggle(user: AdminMember) {
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/admin/users/" + user.id, {
        method: "PATCH",
        body: { disabled: !user.disabled },
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, query]);

  const activeCount = users.filter((u) => !u.disabled).length;

  return (
    <div className="users-admin-stack">
      {health && (
        <section className="account-card system-health-card" aria-label="Sức khỏe vận hành máy chủ">
          <div className="section-heading">
            <div>
              <h2>
                <Icon name="activity" /> Trạng thái vận hành hệ thống
              </h2>
              <small>
                Đồng bộ lúc {formatDateTime(health.checkedAt)} · Bộ lập lịch:{" "}
                {health.schedulerLastCheckedAt
                  ? relativeVi(health.schedulerLastCheckedAt)
                  : "Chưa ghi nhận"}
              </small>
            </div>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void refreshAll()}
            >
              <Icon name="refresh" size={15} />
              {refreshing ? "Đang tải…" : "Làm mới"}
            </button>
          </div>
          <div className="system-health-grid">
            <div className="system-health-metric">
              <span>Hàng đợi worker</span>
              <strong>
                {health.queue.queued} chờ · {health.queue.leased} đang chạy
              </strong>
              <small>Tự động phân tải theo phiên chạy</small>
            </div>
            <div className="system-health-metric">
              <span>Lịch nhận tin</span>
              <strong>
                {health.users.scheduled_users}/{health.users.active_users} bật lịch
              </strong>
              <small>Thành viên đang hoạt động</small>
            </div>
            <div className="system-health-metric">
              <span>Kết nối PostgreSQL</span>
              <strong>
                {health.dbPool.total} kết nối
              </strong>
              <small>
                {health.dbPool.idle} rảnh · {health.dbPool.waiting} chờ cấp phát
              </small>
            </div>
            <div className="system-health-metric">
              <span>Cảnh báo 24 giờ</span>
              <strong
                className={
                  health.queue.dead_letters > 0 || health.queue.failed_24h > 0
                    ? "health-warn"
                    : undefined
                }
              >
                {health.queue.failed_24h} lỗi · {health.queue.dead_letters} dead-letter
              </strong>
              <small>
                {health.queue.dead_letters > 0
                  ? "Mở Quản trị hệ thống để phát lại"
                  : "Không có công việc tồn đọng"}
              </small>
            </div>
          </div>
        </section>
      )}

      <section className="account-card">
        <div className="section-heading">
          <div>
            <h1>
              <Icon name="user" /> Thành viên ({users.length})
            </h1>
            <p className="muted">
              Khóa tài khoản sẽ thu hồi phiên đăng nhập hiện có và dừng các lịch gửi
              mới. Đang hoạt động: <strong>{activeCount}</strong>/{users.length}.
            </p>
          </div>
          {users.length > 3 && (
            <input
              type="search"
              className="inline-search-input"
              placeholder="Tìm theo tên hoặc email…"
              aria-label="Tìm thành viên theo tên hoặc email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </div>
        {error && (
          <p role="alert" className="status error">
            {error}
          </p>
        )}
        <ul className="users-admin-list">
          {filtered.map((u) => (
            <li key={u.id} className="users-admin-row">
              <div>
                <strong>{u.name}</strong>
                <span className="users-admin-meta">
                  {u.email}
                  {u.created_at ? ` · Tham gia ${formatDateTime(u.created_at)}` : ""}
                </span>
              </div>
              <div className="users-admin-actions">
                <span
                  className={
                    u.role === "admin"
                      ? "result-badge running"
                      : u.disabled
                        ? "result-badge failed"
                        : "result-badge success"
                  }
                >
                  {u.role === "admin"
                    ? "Quản trị viên"
                    : u.disabled
                      ? "Đã khóa"
                      : "Đang hoạt động"}
                </span>
                {u.role === "member" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void toggle(u)}
                  >
                    {u.disabled ? "Mở khóa" : "Khóa"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
