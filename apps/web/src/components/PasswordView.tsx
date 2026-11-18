import { useState, type FormEvent } from "react";
import { Icon } from "../Icons";
import { apiRequest } from "../lib/api-client";

export function PasswordView({ onLogout }: { onLogout: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/auth/password", {
        body: {
          currentPassword: form.get("current"),
          password: form.get("password"),
        },
      });
      onLogout();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-card account-narrow-card">
      <h1>
        <Icon name="lock" /> Đổi mật khẩu
      </h1>
      <p className="muted">
        Sau khi đổi thành công, hệ thống sẽ tự động thu hồi mọi phiên đăng nhập cũ
        trên tất cả thiết bị để bảo vệ tài khoản của bạn.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="account-password-field">
            <label htmlFor="current-pw">Mật khẩu hiện tại</label>
            <span className="account-password-input">
              <input
                id="current-pw"
                type={showCurrent ? "text" : "password"}
                name="current"
                autoComplete="current-password"
                required
                maxLength={128}
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={
                  showCurrent ? "Ẩn mật khẩu hiện tại" : "Hiện mật khẩu hiện tại"
                }
              >
                {showCurrent ? "Ẩn" : "Hiện"}
              </button>
            </span>
          </div>

          <div className="account-password-field">
            <label htmlFor="new-pw">Mật khẩu mới (12–128 ký tự)</label>
            <span className="account-password-input">
              <input
                id="new-pw"
                type={showNext ? "text" : "password"}
                name="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
              <button
                type="button"
                onClick={() => setShowNext((v) => !v)}
                aria-label={showNext ? "Ẩn mật khẩu mới" : "Hiện mật khẩu mới"}
              >
                {showNext ? "Ẩn" : "Hiện"}
              </button>
            </span>
          </div>

          {error && (
            <p role="alert" className="status error">
              {error}
            </p>
          )}
          <button className="primary" type="submit">
            {busy ? "Đang lưu…" : "Đổi mật khẩu"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
