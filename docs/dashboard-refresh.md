# Dashboard và thông báo dễ đọc

## Thông báo

PC và GitHub Actions dùng chung formatter `apps/api/src/notifications/format.ts`. Tiêu đề gồm ngày/tháng; nội dung tách thời tiết, tin tức và GitHub bằng dòng trống. Mỗi repository có tên — mô tả ngắn, số sao/mức tăng và liên kết trên dòng riêng. Mô tả lấy từ tác giả trên GitHub, rút gọn theo byte UTF-8; không dùng AI trả phí hoặc tự bịa bản dịch. Tối đa 5 repo trong push, thiếu mô tả ghi rõ. Giới hạn RSS và từng trường giúp giữ đủ 5 repo khi có dữ liệu; tổng message tối đa 3900 byte.

Banner thu gọn do iOS/ntfy quyết định chiều cao và số dòng; muốn đọc đầy đủ cần nhấn giữ/mở rộng hoặc mở ntfy. Mẫu mới không thể ép banner thu gọn hiển thị toàn bộ 5 repo.

## Giao diện

- Màu: nền #F5F7FA, bề mặt #FFFFFF, chữ #172B43, phụ #65758A, nhấn #2563EB, đường chia #E2E8F0.
- Dùng Segoe UI và font hệ thống hỗ trợ tiếng Việt; không tải font ngoài.
- Bốn mục điều hướng Bản tin / Lịch gửi / Hoạt động / Cài đặt, active state rõ ràng.
- Trang chính dùng bản tin mới nhất thật trong database: thời tiết bên trái, repository bên phải, lịch sử phía dưới. Không thay số liệu bằng demo.
- Một hành động chính mỗi trang: tạo bản tin trên danh sách, gửi đến điện thoại trên chi tiết, lưu thay đổi trên cài đặt. Không lặp nút gửi/tạo/tải lại ở nhiều nơi.
- Cài đặt chia năm tab, giữ draft khi chuyển tab; nút lưu chỉ bật khi có sửa. Validation tự mở tab tương ứng và focus trường lỗi.
- Log SSE, ID, lease, quota và lịch sử gửi vẫn truy cập được trong details, tránh chiếm màn hình mặc định.
- Trang lịch phân biệt cloud và cục bộ, không giả lập trạng thái GitHub hoặc tự bật lại lịch local đã tắt.

## Kiểm tra

- 76 unit test qua, gồm test chống mất repo thứ 5 khi nội dung dài và emoji UTF-8, tách dòng, fallback mô tả thiếu.
- Typecheck workspace và build web/API trong Docker qua.
- Playwright: bốn mục điều hướng, đọc bản tin thật, tab cài đặt, save mặc định disabled; latitude 91 bị từ chối tại client và focus đúng trường, không ghi cấu hình sai vào database. Desktop và mobile 390px.
- API/web cập nhật bằng Compose --no-deps; không thay database hoặc migration, không bật lịch local và không đổi GitHub secrets.
