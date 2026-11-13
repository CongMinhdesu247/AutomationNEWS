# Changelog

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
- Nguồn live, push điện thoại, lịch qua ba buổi sáng và baseline GitHub live chưa xác minh. Xem [release-readiness](docs/release-readiness.md).
- Chỉ localhost, single-user; chưa auth/TLS/public hosting, Cron tùy ý, webhook/editor DAG, HA hoặc quota GitHub dùng chung nhiều worker.
- At-least-once execution; không hứa exactly-once HTTP/push. Retention/backup chưa tự chạy. Video chưa quay và giấy phép phân phối chưa được chủ repository chọn.
