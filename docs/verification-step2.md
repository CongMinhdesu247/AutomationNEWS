# Xác minh bước 2

Ngày thực hiện: 11/11/2026 (Asia/Saigon).

## Kiểm tra đạt

- `pnpm install --frozen-lockfile`: lockfile hợp lệ.
- `pnpm typecheck`: contracts, API, web đạt strict TypeScript.
- `pnpm build`: bundle web production và kiểm tra backend/contracts đạt.
- `pnpm test`: **44 test đạt**, không gọi dịch vụ ngoài. Dùng fixture/mock, riêng HTTP transport test dùng server loopback tạm trên máy.
- `pnpm test:integration`: **7 test đạt** với PostgreSQL 17 thật trong Docker, ở schema ngẫu nhiên riêng, có dọn schema sau chạy.
- Migration 002 được chạy trên database development hiện có rồi chạy lại; cấu hình bước 1 được so sánh trước/sau và giữ nguyên. Không sửa migration 001, không xóa named volume hoặc dữ liệu người dùng.
- Full Docker Compose đã build web/API/migrator và chạy migration mới; ba service healthy. Integration cũng đạt 7/7 từ API container. Dashboard production đã được mở bằng Chromium qua Nginx và hiển thị lịch sử rỗng, không có dữ liệu fixture. Xem trạng thái cuối bằng compose ps; API health/ready và danh sách qua Nginx được kiểm tra.

## Nội dung kiểm thử

RSS: GUID/URL trùng, tracking parameter, bài thiếu ngày hoặc quá 24 giờ, plain text không script/HTML, một feed lỗi giữ feed còn lại, concurrency tối đa ba, chỉ lấy mười bài mới nhất.

Thời tiết: ngày đúng múi giờ (UTC 18:00 tương ứng ngày hôm sau ở Việt Nam), ngày phản hồi sai bị từ chối, chỉ số null không thành số 0, ngưỡng gợi ý ô và attribution.

GitHub: chưa có baseline chỉ trả dự án thực sự mới; baseline hợp lệ, mức tăng âm, khoảng giờ thực tế, bỏ snapshot gần nhất cùng ngày; chọn snapshot gần 24 giờ nhất trong nhiều snapshot; hai lần tạo tiếp trong ngày vẫn dùng cùng nền. Bỏ fork/archived, loại trùng ID, đọc quota Search và core riêng; dừng gọi khi hết quota/secondary rate limit, không retry.

Điều phối và database: ba nhánh độc lập, một lỗi/hai thành công lưu partial; timeout tổng lưu failed khi mọi nguồn bật lỗi; giới hạn concurrency; request validation tách lỗi nguồn; hai request tạo đồng thời cùng key chỉ một bản tin; key mới tạo thêm bản tin; phân trang giới hạn kích thước; reload API đọc lại dữ liệu; migration chạy lại đồng thời giữ cấu hình/lịch sử/snapshot.

ntfy: chỉ tóm tắt ngắn, token ở header backend, không thêm link localhost, mỗi attempt độc lập, lỗi HTTP không đổi digest, cùng key không publish lần nữa; mất kết nối đánh unknown và giữ key cũ để không chủ động phát lại.

HTTP: chặn private/loopback/link-local/IPv4-mapped private/metadata, từ chối DNS trả lẫn IP private; LAN ntfy chỉ qua exact-origin allowlist; giới hạn dung lượng/timeout/redirect, kiểm lại địa chỉ đích redirect, POST không đi theo redirect.

## Trình duyệt thật

Playwright/Chromium đã chạy luồng:

1. Mở dashboard development qua proxy cùng origin.
2. Bấm Tạo bản tin ngay → trang chi tiết có RSS, thời tiết, GitHub.
3. Reload → nội dung vẫn được đọc từ PostgreSQL; quay về lịch sử → mở lại đúng ID.
4. GitHub hiển thị chưa có baseline và không có mức tăng sao giả.
5. Bấm gửi ntfy, HTTP fixture cố ý trả 503 → lưu lần gửi lỗi, reload vẫn còn bản tin và lần gửi.
6. Kiểm tra layout 1440px/390px, chụp và xem ảnh, không tràn ngang mobile; vào cài đặt vẫn có dữ liệu bước 1.

HTTP bên ngoài được inject bằng fixture có nhãn [Fixture] trên UI, database là PostgreSQL thật với schema riêng. Fixture không được đưa vào database ứng dụng. Schema fixture đã dọn sau kiểm tra. Ảnh trong output/playwright/step2-desktop.png và step2-mobile.png (gitignore).

## Smoke nguồn công khai

Ba request bằng HTTP client thật, mỗi nguồn một request: Open-Meteo forecast, GitHub Search page một với per_page=1, RSS VnExpress. Cả ba trả HTTP 200. Không gửi ntfy thật; không có token/Authorization trong log. Smoke chỉ xác minh kết nối/response, không thay thế kiểm thử connector bằng fixture.

## Giới hạn xác minh

Không kiểm tra nhận push trên điện thoại hoặc ntfy self-host thật. Chưa chờ thực tế 24 giờ; logic baseline được kiểm bằng clock và snapshot fixture trên PostgreSQL. Chưa kiểm tra Firefox/Safari/thiết bị di động thật hoặc chạy tải dài ngày. Chưa kiểm thử public hosting vì deployment chỉ cho localhost.

Môi trường có lỗi cấp phát bộ nhớ khi khởi động công cụ và Docker Desktop từng mất kết nối ở lượt kiểm tra cuối. Sau khi giới hạn bộ nhớ công cụ và khởi động lại Docker, đã chạy lại integration thành công và build Compose. Đây không phải phép thử khôi phục job: API hiện chưa tự phục hồi công việc gián đoạn.

Không tạo commit hoặc push.
