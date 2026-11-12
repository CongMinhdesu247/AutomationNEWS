# Giá RON 95 trong bản tin sáng

- Bật `fuel.enabled` trong cấu hình local hoặc `HUB_SETTINGS_JSON` trên cloud. Cấu hình cũ thiếu trường này vẫn hợp lệ và mặc định tắt ở local. Workflow cloud bật `HUB_FUEL_ENABLED=true` làm giá trị dự phòng khi secret chưa có trường `fuel`; cấu hình `fuel` rõ ràng trong secret được ưu tiên. Không cần thay đổi secret hiện có.
- Chỉ lấy nhóm RON 95; giữ nguyên E10 và cấp III/V như tên Petrolimex công bố. Không gộp chúng thành một giá duy nhất. Hiển thị giá vùng 1, đồng/lít.
- Nguồn là JSON công khai của widget “Giá bán lẻ xăng dầu” trên https://www.petrolimex.com.vn/ và thông cáo giá trên cùng trang. Request không dùng tài khoản, token, hay dịch vụ trả phí.
- Endpoint widget được xác minh qua mã JavaScript công khai của chính website (`_themes/sunrise/js/all.js`, `__vieapps.prices.fetch`). Đây là endpoint website, không có cam kết API ổn định; nếu cấu trúc thay đổi, nguồn báo lỗi và các nhánh còn lại tiếp tục chạy.
- Xác minh ngày hiệu lực từ thông cáo. Không hiển thị giá mới trước hiệu lực; không gán ngày thông cáo mới cho bảng giá cũ lệch quá 24 giờ. `LastModified` của widget được lưu riêng, không coi là giờ hiệu lực.
- Cloud lưu giá của lần gửi thành công trước để so sánh theo đúng ID sản phẩm. Lần đầu, sản phẩm mới, hoặc baseline quá 14 ngày: không tự suy ra mức tăng/giảm. Chạy thử không thay đổi baseline. Local so với bản tin đã hoàn tất gần nhất có dữ liệu giá thành công.
- Nhánh DAG `fetch_fuel` độc lập, dùng timeout/retry/DLQ hiện có. Không cần thay đổi schema PostgreSQL; kết quả nằm trong JSON bản tin.
- Formatter chung cho local/cloud: phần giá đặt sau thời tiết, trước tin tức và GitHub. Giữ giới hạn 3.900 byte UTF-8; kiểm thử vẫn giữ đủ 5 repo khi có hai giá RON 95 và năm tiêu đề RSS dài.

Kiểm tra: `pnpm exec vitest run apps/api/src/connectors/fuel.test.ts apps/api/src/cloud/cloud.test.ts apps/api/src/notifications/format.test.ts`; `pnpm typecheck`; `pnpm build`.
