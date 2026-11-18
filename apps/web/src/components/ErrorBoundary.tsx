import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    const cleanMessage =
      error.message && error.message.length <= 160
        ? error.message
        : "Đã xảy ra sự cố hiển thị ngoài dự kiến.";
    return {
      hasError: true,
      message: cleanMessage,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("UI ErrorBoundary caught error:", error, info.componentStack);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="account-root account-error-boundary">
        <div className="account-card">
          <p className="section-kicker">Sự cố giao diện</p>
          <h1>Trang cần được làm mới</h1>
          <p>
            Một thành phần hiển thị vừa gặp gián đoạn ({this.state.message}). Dữ
            liệu bản tin và cấu hình tài khoản của bạn vẫn an toàn trên máy chủ.
          </p>
          <div className="error-boundary-actions">
            <button
              type="button"
              className="primary"
              onClick={() => window.location.reload()}
            >
              Tải lại ứng dụng
            </button>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: "" });
                window.location.hash = "/digests";
              }}
            >
              Về Bản tin của tôi
            </button>
          </div>
        </div>
      </main>
    );
  }
}
