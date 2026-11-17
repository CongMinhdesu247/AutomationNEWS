# Changelog

## Chuẩn bị phát hành — premium-beta-20261116-r2 (2026-11-16)

- Thanh điều hướng trên điện thoại cho phép nhãn xuống dòng và hiển thị bánh răng cân đối hơn.
- Hai dấu chấm than mở hướng dẫn về lịch và thông báo ntfy ngay cạnh ô chọn.
- Gói cho HP đi kèm Premium beta và các migration 011–013 từ bản r1.

## Chưa phát hành — Premium beta (2026-11-15)

- Gói/entitlement Free và Premium tách admin/member; admin cấp/gia hạn/thu hồi có audit, không miễn quota cho admin. Migration 011–012 bổ sung, không sửa migrations cũ hay lịch/settings.
- Theo dõi tùy chỉnh: form/preview/xác nhận, nguồn RSS công khai chờ duyệt, cache dùng chung, matching deterministic, kết quả riêng tư có lưu/ẩn, section trong bản tin/ntfy hiện tại.
- Tác vụ Premium dùng queue/lease/recovery hiện có. Giữ riêng hạn mức bản tin thường, không tính AI/search vào giới hạn tạo digest thủ công.
- Adapter Gemini/disabled/fake và Brave Search/disabled/fake, quota và budget reservation atomic, không retry call chưa rõ phí. Mặc định AI/search tắt, budget 0, FREE_ONLY bật; search yêu cầu xác minh quyền lưu/cache.
- Giao diện user/admin, CI fixture, retention, migration có dữ liệu cũ, restore cô lập, runbook HP. Chưa triển khai Premium lên HP, chưa gọi provider trả phí hoặc gửi thông báo điện thoại thật.

## Chưa phát hành — tài khoản và máy chủ tại nhà (2026-11-15)

- Đăng ký có thể bật/tắt, đăng nhập, đổi mật khẩu, phiên cookie HttpOnly/Secure, hash mật khẩu scrypt và giới hạn yêu cầu lưu trong PostgreSQL.
- Cấu hình, phiên bản lưu, lịch theo ngày/múi giờ, lịch sử bản tin và topic ntfy riêng theo tài khoản. Giới hạn tạo/gửi thủ công và kiểm tra quyền trên API/SSE; API legacy dành cho admin.
- Cổng người dùng trên mobile/desktop, giao diện sáng/tối, xem trước bằng tạo bản tin và gửi thử từ trang chi tiết; admin quản lý khóa/mở khóa thành viên.
- Migration 010 giữ dữ liệu cũ, thêm chủ sở hữu vào run/digest, giữ owner khi replay và tách chống trùng lịch theo người dùng.
- Bộ triển khai Ubuntu/Cloudflare Tunnel riêng cho AutomationNEWS, CLI tạo admin/reset mật khẩu, đóng gói source không chứa secret. Chưa triển khai lên máy chủ HP EliteDesk hoặc thay DNS.
- Chưa có xác minh email/reset qua email hoặc credential ntfy riêng cho từng người. Luồng cảnh báo ngoài lịch legacy chưa được chuyển thành cảnh báo tài khoản.

## 1.0.0 — bản chuẩn bị phát hành (2026-11-12)

Chưa công khai repository, tạo Git tag hoặc GitHub Release. Đây là nội dung phát hành dự kiến để chủ dự án xem xét.

### Tính năng trong v1.0.0

- Dashboard tiếng Việt, responsive; contracts Zod dùng chung, lưu nguyên tử năm nhóm cấu hình vào PostgreSQL.
- Connector RSS 24 giờ, chuẩn hóa URL/tracking và plain text; Open-Meteo theo múi giờ với attribution; GitHub REST, snapshot sao 20–28 giờ và fallback dự án mới khi thiếu baseline.
- DAG `digest.v1` sáu node; ba nhánh nguồn độc lập, compose `all_settled`, phân biệt execution status và chất lượng bản tin.
- PostgreSQL queue: `FOR UPDATE SKIP LOCKED`, lease/heartbeat, fencing token, bounded crash recovery, idempotent submit/persist và attempt history.
- Retry theo lỗi với backoff/jitter/Retry-After, DLQ và replay bằng snapshot sang run mới.
- Lịch hằng ngày theo giờ/múi giờ, notification outbox và ntfy thủ công/tự động; không chủ động gửi lại kết quả unknown.
- Event store transactionally ordered theo run, SSE cursor/replay/reset, heartbeat, giới hạn buffer/kết nối; timeline dedup và reconnect trên dashboard.
- Docker Compose localhost, migration 001–006, backup/restore PowerShell và retention batch/dry-run với reset cursor đã hết hạn.
- Demo fixture có nhãn riêng, benchmark có dữ liệu thô, tài liệu kiến trúc/vận hành/video/CV và checklist ba buổi sáng.

### Điều chỉnh trong lần chuẩn bị phát hành

- Khai báo version 1.0.0 cho workspace packages; cập nhật HTTP User-Agent theo version.
- Sửa Nginx giữ DNS/IP cũ sau khi recreate API: phân giải lại qua Docker DNS cho REST và SSE, giữ nguyên request URI/cursor.
- Thêm WEB_PORT cho Compose và port riêng cho demo để cài song song mà không dừng ứng dụng đang dùng.
- Giới hạn Vitest discovery trong apps/packages, tránh chạy nhầm test trong bản sao output.
- Tạo cache Vite/Vitest với quyền ghi cho user node trong image; giữ source ứng dụng không cấp quyền ghi rộng.
- Kiểm chứng cài mới từ source không có personal .env/node_modules/dist; migration chạy lại và cấu hình qua restart vẫn giữ dữ liệu.

### Bằng chứng và giới hạn

- Typecheck/build, frozen lockfile, 61 unit test và 40 integration test PostgreSQL thật đã qua trong lần kiểm tra v1.0.0; browser fixture/SSE qua Nginx cũng qua.
- Benchmark cũ được giữ nguyên và chỉ diễn giải như kết quả fixture; không có tuyên bố hiệu năng production mới.
- Nguồn live, push điện thoại, lịch qua ba buổi sáng và baseline GitHub live chưa xác minh. Xem [release-readiness](docs/portfolio/release-readiness.md).
- Chỉ localhost, single-user; chưa auth/TLS/public hosting, Cron tùy ý, webhook/editor DAG, HA hoặc quota GitHub dùng chung nhiều worker.
- At-least-once execution; không hứa exactly-once HTTP/push. Retention/backup chưa tự chạy. Video chưa quay và giấy phép phân phối chưa được chủ repository chọn.
