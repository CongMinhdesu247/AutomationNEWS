# Chất lượng không khí Hà Nội

- Nguồn: [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api), mô hình CAMS Global, tọa độ trung tâm Hà Nội 21.0285, 105.8542. Không yêu cầu tài khoản hoặc API key cho mục đích cá nhân phi thương mại.
- Lấy `current=us_aqi,pm2_5`, `timeformat=unixtime`, `domains=cams_global`. Lưu thời điểm dự báo bằng UTC và hiển thị theo giờ Việt Nam. Đây là dự báo mô hình khu vực, không phải số đo tại trạm gần người dùng.
- Dùng trực tiếp AQI theo thang Mỹ do nguồn trả về, không suy AQI từ riêng PM2.5. Nhãn tiếng Việt: 0–50 Tốt; 51–100 Trung bình; 101–150 Không tốt cho nhóm nhạy cảm; 151–200 Không tốt; 201–300 Rất không tốt; trên 300 Nguy hại. Làm tròn AQI trước khi hiển thị/phân loại.
- PM2.5 có đơn vị µg/m³. Giá trị 0 được giữ nguyên; thiếu chỉ số trả `partial`, thiếu cả hai trả `failed`. Từ chối timestamp cũ quá 3 giờ hoặc tương lai quá 10 phút. Không tái sử dụng số liệu cũ mà không báo lỗi.
- `airQuality.enabled` bật/tắt nguồn. Cấu hình cũ thiếu trường này vẫn hợp lệ và mặc định tắt local. Workflow bật `HUB_AIR_QUALITY_ENABLED=true` để làm dự phòng cho secret cũ; cấu hình rõ ràng trong secret được ưu tiên.
- Nhánh DAG `fetch_air_quality` độc lập, chỉ thêm khi nguồn được bật; dùng timeout, retry và DLQ hiện có. Lỗi nguồn này không chặn các nguồn khác.
- Kết quả lưu trong JSON bản tin, không cần migration mới. Cloud không lưu dữ liệu AQI vào nhánh public state. Attribution Open-Meteo/CAMS và CC BY 4.0 xuất hiện trong dashboard/thông báo.
- Thông báo vẫn giữ tối đa 3 tin RSS, 1 loại Xăng E10 RON 95-III và 5 repo GitHub. Kiểm thử formatter xác minh đủ nội dung trong giới hạn 1.600 byte UTF-8.

Kiểm tra: `pnpm test`, `pnpm build`. Kiểm thử riêng: `pnpm exec vitest run apps/api/src/connectors/air-quality.test.ts apps/api/src/cloud/cloud.test.ts apps/api/src/notifications/format.test.ts apps/api/src/workflows/definition.test.ts`.
