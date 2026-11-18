# Kiểm chứng tài khoản và triển khai tại nhà — 2026-11-15

## Cập nhật giao diện cùng ngày

- Thống nhất màu xanh ngọc, kiểu chữ, icon, nút và khoảng cách cho đăng nhập/đăng ký, bản tin, tùy chọn và tiến độ. Bố cục đăng nhập không còn tính padding theo viewport bên trong một main đã giới hạn chiều rộng.
- Điện thoại có thanh điều hướng dưới, menu tài khoản gọn, các trường nhập cỡ 16px và nút lưu nằm phía trên điều hướng. Tài khoản chưa chọn nguồn được dẫn tới chọn nội dung thay vì gửi một yêu cầu tạo bản tin sẽ lỗi.
- Đã xem ảnh desktop 1440/1920px, điện thoại 390px; kiểm tra trang chi tiết ở 320px không tràn ngang. Nút lưu và thanh điều hướng ở 390px không đè nhau. Đã kiểm tra đăng ký, lưu cấu hình/giao diện tối, tạo bản tin qua worker fixture và mở nội dung.
- Frontend typecheck/build và Docker build đạt; 4 test frontend hiện có đạt. Kiểm tra bản Docker thật tại port 8088 cho trang đăng nhập ở desktop/điện thoại. Dữ liệu nguồn và thông báo khi nghiệm thu tài khoản vẫn dùng fixture riêng.
- Sửa Nginx không cache entry HTML và trả 404 cho bundle đã bị thay thế, tránh màn hình trắng sau cập nhật. Đã kiểm tra HTML có `Cache-Control: no-store`, bundle hiện tại trả JavaScript, bundle cũ trả 404 và SPA fallback vẫn hoạt động.

Ảnh mới: `output/playwright/redesign-*.png`. Frontend cục bộ đã được cập nhật bằng build lại riêng service web; không thay tài khoản, dữ liệu hoặc cấu hình nguồn của người đang sử dụng.

Các kiểm thử dữ liệu dùng database/container riêng trên máy phát triển. Sau yêu cầu sửa giao diện, service web ở port 8088 đã được cập nhật; không thay dữ liệu tài khoản, các dịch vụ khác trên cùng máy chủ, DNS hoặc máy chủ đích.

## Kết quả

- Typecheck toàn workspace: đạt.
- Build frontend/backend/worker/scheduler: đạt, bao gồm build Docker từ frozen lockfile.
- Vitest toàn bộ unit và integration: **30 file, 179 test đạt**. PostgreSQL 17 tại `127.0.0.1:54369`, database `accounts_test`; mỗi suite có schema ngẫu nhiên riêng.
- Suite tài khoản có 4 test luồng: xác thực bắt buộc, chặn origin khác, hash mật khẩu/token, cách ly cấu hình/lịch sử/detail/SSE/gửi thông báo, revision riêng, idempotency theo tài khoản, lịch đồng thời, outbox, khóa tài khoản/thu hồi phiên, đổi mật khẩu, hết hạn phiên, múi giờ/DST/ngày nhận, chặn nâng quyền qua payload và quota khi tạo đồng thời.
- Hai kiểm tra cũ được cập nhật để khớp lịch sử dự án: mặc định SQL legacy chưa chứa các nguồn optional mới; số migration là 10. Kiểm tra gửi ambiguous đếm POST thông báo thay vì tính cả GET dịch mô tả GitHub.
- Docker Compose home: parse được cả profile `tools`, `quick`, `tunnel`. Image cloudflared được pin bằng digest lấy từ registry; đã kiểm tra image hỗ trợ `--token-file`.
- Stack `hub-account-review` ở port loopback 8109: migration chạy lại được, API/web/db healthy, worker/scheduler hoạt động. CLI owner chạy trong container bằng pnpm/tsx; tạo admin, login qua Nginx thành công, topic ngẫu nhiên được cấp và lịch tài khoản mới tắt. Không sử dụng secret thật hoặc bật nguồn trong stack này.
- Browser với API thật và HTTP fixture: đăng ký → chọn Hà Nội/thời tiết/chủ đề công nghệ → bật lịch/ntfy → lưu → tạo bản tin → SSE đồng bộ completed → mở bản tin → gửi fixture thành công. Lưu giao diện tối, reload vẫn giữ tài khoản và cấu hình. Đã xem ảnh viewport 390×844 và 1440×1000.

Ảnh kiểm tra nằm trong `output/playwright/account-mobile.png`, `account-dark.png`, `account-digest-dark.png` trên máy phát triển; không đưa vào gói source. HTTP fixture không gọi nguồn ngoài hoặc gửi ntfy thật. Console trước đăng nhập có phản hồi 401 dự kiến của `/api/account`.

## Giới hạn chưa xác minh

- SSH tới `<ssh-user>@<server-tailscale-ip>` không kết nối được từ môi trường kiểm thử cô lập; không đọc hoặc chuyển private key.
- Chưa triển khai/migrate trên Ubuntu đích; chưa tạo DNS/named tunnel, kiểm chứng HTTPS public, tải nhiều người, khởi động lại máy chủ hoặc push trên điện thoại thật qua một buổi sáng.
- Tên miền riêng đang chờ kích hoạt DNS; `news.example.com` là hostname dự kiến.
- Quick Tunnel không được bật trong nghiệm thu để tránh public dữ liệu fixture; khi dùng tạm, tiến độ cần tải lại vì Quick Tunnel không hỗ trợ SSE.

Triển khai và nghiệm thu tiếp theo theo [home-server.md](../guides/home-server.md), bằng PC có kết nối Tailscale và khóa SSH được server cho phép. Gói source chứa migration mới và hướng dẫn backup; không có dữ liệu/secret cá nhân.
