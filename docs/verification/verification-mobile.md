# Safari và biểu tượng màn hình chính — 15/11/2026

- Lỗi được báo: `AbortSignal.any is not a function` ở màn hình lịch sử/chi tiết lần chạy trên iPhone. Đã thay các static API `AbortSignal.any/timeout` ở frontend bằng `requestSignal`, dùng AbortController, timer và listener hủy có giới hạn thời gian. Giữ hủy yêu cầu khi rời trang chi tiết lần chạy.
- Thêm manifest cùng origin, `display: standalone`, metadata iOS, apple-touch-icon 180px và icon 192/512px hình mặt trời theo logo. Không thêm service worker hoặc cache API/tài khoản; không có chế độ offline.
- Thêm nền SVG mặt trời mờ và padding safe area cho header. Cấu hình này không thể ẩn thanh địa chỉ của tab Safari thông thường: phải xóa shortcut cũ, thêm lại vào màn hình chính, bật Open as Web App nếu có rồi mở từ biểu tượng.
- Đã qua build web và 142 unit tests, gồm bốn regression tests timeout/hủy yêu cầu. Trình duyệt fixture tắt cả hai static API trước khi tải trang: đăng ký, lưu cấu hình, tạo bản tin, xem danh sách và chi tiết lần chạy đều qua; viewport 390×844. Đây là mô phỏng thiếu API trên Chromium, chưa phải nghiệm thu iPhone thật.
- Đã cập nhật riêng service web tại máy chủ và localhost 8088. Public HTTPS, manifest đúng MIME, ba PNG và SVG nền trả 200; web healthy, API ready, các dịch vụ khác trên cùng máy chủ vẫn ổn định. Không restart tunnel hoặc thay database.
- Trên HP, image trước cập nhật được giữ ở `automationnews-web:before-mobile-fix-20261115`; source web trước cập nhật ở `backups/web-before-mobile-20261115.tar.gz`. Có thể tag image này về `automationnews-web:latest` và chạy Compose `up -d --no-deps web` (không build) để rollback giao diện.

Tham khảo: [Apple: cấu hình web app trên màn hình chính](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html), [MDN: AbortSignal.any](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static).
