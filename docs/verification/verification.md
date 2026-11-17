# Xác minh bước 1

Ngày thực hiện: 11/11/2026, múi giờ Asia/Ho_Chi_Minh.

## Kết quả

- `pnpm install --frozen-lockfile`: thành công, lockfile không cần cập nhật.
- `pnpm typecheck`: đạt cho contracts, API và web, strict mode.
- `pnpm build`: đạt; frontend tạo bundle production, API/contracts được typecheck và chạy bằng tsx.
- `pnpm test`: 16 kiểm thử validation đạt.
- `pnpm test:integration`: đạt với PostgreSQL 17 thật trên Docker, chạy từ host ở chế độ development và từ API container.
- `docker compose --env-file .env -f infra/compose.yaml up -d --build --wait`: build và khởi động stack thành công. Database, API, web healthy; migration exit 0.

Integration test chạy trên schema ngẫu nhiên riêng và dọn schema đó sau kiểm tra. Xác minh lưu/đọc năm nhóm, API khởi tạo lại vẫn đọc đúng, dữ liệu sai/trùng RSS bị từ chối mà không đổi cấu hình, migration chạy lại đồng thời giữ dữ liệu, lỗi PostgreSQL sau UPDATE rollback và không lộ chi tiết lỗi, health/readiness độc lập.

## Trình duyệt thật

Dùng Playwright CLI với Chromium trên localhost, không chỉ kiểm tra qua HTTP:

- Mở dashboard development và dashboard production qua proxy cùng origin.
- Chỉnh cả năm nhóm, thêm RSS, lưu rồi reload; các giá trị vẫn đúng.
- GitHub bỏ tag rỗng/trùng và hiển thị dữ liệu đã chuẩn hóa.
- Latitude 91 bị chặn, database giữ giá trị cũ.
- Chủ động trả 503 cho request PUT để xác minh UI giữ bản nháp khi lưu thất bại.
- Giữ request PUT đang chờ để xác minh nút lưu và các trường bị disabled.
- Sửa RSS, lưu/reload; xóa RSS, lưu/reload; kết quả tồn tại đúng.
- Dừng và khởi động lại toàn bộ database/API/web bằng Compose, reload vẫn đọc lại cấu hình đã lưu.
- Chụp và xem giao diện desktop 1440px và mobile 390px; không có tràn ngang trên mobile.
- Kiểm tra các request trong luồng chỉnh/lưu/reload chỉ đến origin localhost; không gọi URL tích hợp đã cấu hình.
- Khôi phục cấu hình gốc sau kiểm thử trình duyệt. Không xóa volume hoặc dữ liệu có trước, không tạo commit/push.

Ảnh kiểm tra nằm trong output/playwright/ (được gitignore). Các lỗi HTTP có chủ đích trong phép thử 503 không phải lỗi vận hành ngoài dự kiến. Lần kiểm tra đầu phát hiện vùng bấm checkbox bị phần trang trí che; đã sửa và chạy lại thành công. Favicon cũng đã được bổ sung.

## Giới hạn của việc xác minh

Đã kiểm tra trên Windows PowerShell 7, Node 24, Docker Linux containers và Chromium. Chưa kiểm tra trực tiếp PowerShell 5.1, Firefox, Safari hoặc thiết bị di động thật. Lệnh README dùng cú pháp tương thích PowerShell 5.1. Image theo tag ổn định, chưa pin digest; dependency JavaScript được khóa bằng lockfile. Chưa có kiểm tra tải, public hosting hoặc tích hợp bên ngoài vì nằm ngoài bước 1.
