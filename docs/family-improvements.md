# Bản tin gia đình: theo dõi, cá nhân hóa và khôi phục

## Sử dụng

Mở dashboard → **Gia đình** → chọn hồ sơ. Mục **Trạng thái cloud** đọc ledger GitHub thật, làm mới mỗi phút: đã gửi, lỗi, giữ lượt/chưa xác nhận; có thời điểm nguồn, lịch sử 10 lần gần nhất và lịch kế tiếp. Đây là xác nhận máy chủ gửi, không phải xác nhận iPhone hiện banner. Nút **Gửi lại / gửi thử** tạo thêm một thông báo dù đã gửi hôm nay. Không tự gửi lại một POST có kết quả mơ hồ.

Vàng/USD ngày trước được ghi **Giá gần nhất**. Dashboard so ngày Việt Nam với ngày hiện tại, kể cả khi mở bản tin cũ. Nguồn quá cũ bị connector từ chối như trước; không dùng giá cũ cho cảnh báo biến động.

## Cảnh báo biến động (mặc định tắt)

Trong từng hồ sơ, chọn **Cảnh báo biến động**, đặt mức vàng (đồng/chỉ), USD (đồng/USD), AQI Mỹ. Chỉ kiểm tra những nguồn đã bật; vàng so từng giá mua/bán của đúng loại, USD so tiền mặt/chuyển khoản/bán riêng biệt. So với giá ở lần thông báo thành công gần nhất, không phải mặc định so hôm qua hay suy luận xu hướng đầu tư. AQI là dự báo, báo khi từ dưới lên ngưỡng; khi hạ xuống thì tái kích hoạt.

GitHub kiểm tra mỗi 30 phút, sau giờ bản tin trong ngày đã chọn và trong 09:00–20:00 giờ Việt Nam. Tối đa hai lượt cảnh báo/ngày, cách nhau ít nhất sáu giờ tính từ lần thử gửi gần nhất (kể cả kết quả mơ hồ). Lần đầu ghi mốc, không báo một biến động không có cơ sở. GitHub có thể chạy muộn; không phải cảnh báo theo giây.

## Bản tin chi tiết khi PC tắt

`docs/report.html` là trình đọc tĩnh trên GitHub Pages (`main:/docs`, tắt Jekyll). Biến Actions **HUB_REPORT_BASE_URL** chỉ bật sau khi trang đã được triển khai, ví dụ `https://OWNER.github.io/REPO/report.html`. Thiếu biến này thì vẫn gửi bản ngắn như trước, không tạo link hỏng.

Cloud mã hóa AES-256-GCM một bản text đầy đủ (3 tin, tối đa 5 repo và mô tả, URL, giá/thời điểm nguồn); ghi ciphertext vào state trước khi POST ntfy. Khóa ngẫu nhiên 256 bit chỉ nằm trong fragment của link gửi qua ntfy, không nằm trên nhánh state. Không lưu settings/topic trong nội dung bản tin. Người có link có thể đọc bản đó; không đăng link công khai. State giữ tối đa 16 bản gần nhất cho toàn gia đình sau mỗi lần dọn; hết hạn 14 ngày. Không phải kho lưu trữ vĩnh viễn. Trình đọc không tải script/analytics bên ngoài; dùng text/DOM an toàn.

## Cài đặt riêng trên điện thoại

Owner mở hồ sơ → **Liên kết cài đặt riêng** → tạo link rồi chia sẻ trực tiếp cho đúng người. Link 90 ngày, lưu hash SHA-256 trong bảng `member_access`; tạo mới/thu hồi làm link cũ hết hiệu lực. Người nhận chỉ được đổi nội dung, địa điểm, lịch, ngưỡng, tạm dừng của chính mình; không đổi topic/ID/tên hoặc xem hồ sơ người khác. Lưu có revision chống ghi đè và đồng bộ Actions Secret bằng kết nối server; không đưa token GitHub vào điện thoại.

Dashboard owner vẫn chỉ bind loopback 8088. Gateway riêng 8089 chỉ mở `/api/member`, chặn mọi API owner. Chạy:

```powershell
docker compose --env-file .env -f infra/compose.yaml -f infra/family-access.yaml up -d --wait
```

Đặt `MEMBER_PUBLIC_URL=http://IP_LAN_CUA_PC:8089` trong `.env` để điền sẵn địa chỉ, hoặc nhập trong dashboard. Điện thoại phải truy cập được PC (thông thường cùng Wi-Fi), PC/server quản lý phải đang bật để sửa hồ sơ. **Tắt PC vẫn nhận lịch và mở bản tin chi tiết; chưa thể sửa cấu hình khi PC tắt.** Không mở port dashboard owner ra Internet. Nếu tự host lâu dài bên ngoài, dùng HTTPS cho gateway và đặt `MEMBER_PUBLIC_URL` tương ứng. Có thể cần cho phép cổng 8089 trong firewall của mạng riêng trên Windows; ứng dụng không tự thay firewall/router.

## Sao lưu

Mở **Sao lưu & khôi phục hồ sơ**. Tệp JSON được mã hóa tại trình duyệt bằng AES-256-GCM, khóa dẫn xuất PBKDF2-SHA256 250.000 vòng, salt và IV ngẫu nhiên, mật khẩu 10–200 ký tự. Không gửi mật khẩu tới server. Tệp gồm cấu hình gia đình/topic, không chứa token quản trị, link cá nhân hoặc database lịch sử. Nhớ mật khẩu; không có cơ chế khôi phục mật khẩu.

Khôi phục: chọn tệp → nhập mật khẩu → **Mở & xem trước** → **Đưa vào bản nháp** → kiểm tra → **Lưu & đồng bộ**. Không tự áp dụng khi chỉ mở tệp. Trên máy mới cần cấu hình lại kết nối quản trị GitHub trước khi lịch cloud được đồng bộ.

## Kiểm chứng

Kiểm thử `cloud/enhancements.test.ts`: lịch theo ngày Việt Nam, freshness, ngưỡng, AQI crossing, AES-GCM/tamper, reservation trước POST, telemetry, dry-run không ghi/gửi, cooldown sau lỗi mơ hồ, khung giờ và dọn report. `family-backup.test.ts`: round-trip, sai mật khẩu, sửa ciphertext, giới hạn. Integration family trên schema PostgreSQL thử riêng: quyền từng hồ sơ, field allowlist, revision, xoay/thu hồi/hết hạn token, không lộ topic và đọc trạng thái. Không dùng thông báo thật để nghiệm thu vào ban đêm.
