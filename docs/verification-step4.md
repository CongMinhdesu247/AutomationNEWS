# Kiểm chứng bước 4

Ngày kiểm tra: 11/11/2026, Asia/Saigon.

## Môi trường và phạm vi

Node 24.21.0, pnpm 11.25.0, Vitest 5.1.0. PostgreSQL 17 trong container thử riêng, port localhost 54339; integration test tạo schema UUID và dọn schema của chính mình. Không migrate, reset hay xóa volume database đang phục vụ ứng dụng. Không gửi ntfy thật hoặc gọi RSS/GitHub/Open-Meteo trong test.

## Kết quả

- pnpm typecheck: qua cả web/API/engine/contracts/worker/scheduler.
- pnpm test: 53 test qua.
- pnpm test:integration: 28 test qua trên PostgreSQL thật.
- pnpm build: qua.
- Docker Compose build api, worker, scheduler, web: qua, frozen lockfile.
- Khởi động entry point scheduler thật với database thử: log khởi động thành công và lastCheckedAt trên API tiếp tục cập nhật. Dừng các tiến trình thử và container database thử sau khi kiểm tra.

Kiểm tra mới gồm phân loại lỗi, exponential jitter/cap, Retry-After hai dạng và không rút ngắn server hint; giờ Việt Nam và giờ DST không tồn tại; job chưa đến hạn không được claim kể cả tạo queue/worker mới; retry rồi thành công; exhausted/permanent error vào DLQ; concurrent replay cùng mục trả một run; stale token không ghi sau retry lease mới; nhiều scheduler chỉ tạo một run/ngày; manual run vẫn độc lập; bỏ lịch quá cũ, đổi giờ và tắt lịch; transactional notification outbox, gửi một lần giữa hai scheduler bằng destination snapshot; không gửi lại khi response ambiguous hoặc sending hết lease; bỏ gửi bản tin thuộc lịch ngày cũ; validation API/pagination/replay.

Các test bước 2 được đặt maxRetries=0 để tiếp tục cô lập aggregation/timeout, còn suite reliability kiểm tra retry thật. Test migration cập nhật số migration thành 4. Test bước 3 vẫn kiểm tra crash worker process thật, recovery và race của node gộp.

## Trình duyệt

Dùng Playwright CLI với API kết nối database thử riêng, HTTP fixture trả 503 tạo DLQ và retry chờ. Không dùng fixture trong ứng dụng production.

- Desktop 1280×720: trang Lịch & tác vụ lỗi hiển thị giờ 07:00 Asia/Ho_Chi_Minh và lần chạy kế tiếp.
- Bấm Tạo run chạy lại: chuyển tới run mới. Quay lại/reload thấy liên kết run đã tạo.
- Mobile 390×844: trang lịch và trang tiến độ hiển thị được, document scrollWidth=390 không tràn ngang.
- Trang tiến độ hiển thị retryCount, availableAt và nguồn đang chờ.
- Console được kiểm tra không có error/warning lúc mở trang lịch.
- Ảnh trong output/playwright/step4-desktop.png, step4-mobile-schedule.png và step4-mobile-run.png; output được gitignore.

## Giới hạn kiểm chứng

Chưa gửi push thật tới điện thoại, chưa chờ lịch qua đêm và chưa kiểm tra mạng ngoài bằng credential của người dùng. Sending không rõ kết quả không tự retry; người dùng kiểm tra trước khi gửi lại thủ công. Chưa triển khai SSE hoặc Cron expression tùy ý.

Đã build image mới nhưng không thay container ứng dụng đang chạy. Áp dụng vào stack hiện có bằng lệnh Docker Compose trong README; migration 004 tự chạy trước API/worker/scheduler. Giữ nguyên .env và volume.
