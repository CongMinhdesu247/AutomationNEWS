# Tóm tắt repository bằng tiếng Việt

Mô tả gốc của tác giả được giữ trong `description`. Bản dịch rút gọn lưu riêng ở `summaryVi`, kèm `summaryViStatus` (translated/original_vi/unavailable/missing). Đây là bản dịch tự động từ mô tả công khai của tác giả, không phải nhận xét độc lập hoặc phần tóm tắt do LLM suy diễn từ source code.

## Cách hoạt động

- GitHub search chỉ chọn repository public, không fork/archived. Chỉ các repository đã chọn vào bản tin mới được dịch, không dịch hàng trăm ứng viên.
- Nhận diện tiếng Việt/Trung/Nhật/Hàn theo chữ viết, các ngôn ngữ khác dùng franc-min 6.2.0 và quy tắc cho mô tả kỹ thuật tiếng Anh. Mẫu quá ngắn hoặc mơ hồ có thể nhận diện sai.
- MyMemory REST API get, target vi, không tài khoản/key/thẻ thanh toán hoặc fallback trả phí. Mỗi segment tối đa 450 byte UTF-8, dưới giới hạn API 500 byte. Chỉ gửi mô tả repository công khai, không gửi token GitHub/ntfy, topic, tọa độ hoặc cấu hình người dùng.
- Mô tả tiếng Việt giữ nguyên, mô tả trống có thông báo rõ ràng. HTTP lỗi, hết quota hoặc timeout trả câu tiếng Việt “Chưa dịch được mô tả…”; không thay bằng một công dụng tự bịa và không khiến cả bản tin thất bại.
- Quá trình dịch có deadline 9 giây cho cả danh sách, 3 giây mỗi request; không tự retry dịch và có cooldown sau lỗi. Ngưỡng 3500 ký tự/ngày/instance tránh gửi quá nhiều; hạn mức thật do nhà cung cấp kiểm soát theo IP. Không cam kết dịch luôn khả dụng trên IP runner dùng chung.
- Cache theo SHA-256 ngôn ngữ + mô tả đã chuẩn hóa, đổi mô tả thì dịch lại; chia sẻ request đang chạy, tối đa 150 mục/30 ngày. Cloud lưu cache trong nhánh state hiện có, chỉ chứa bản dịch của nội dung công khai và timestamp. Đọc state cũ không có cache vẫn được hỗ trợ. Cache không chứa cấu hình cá nhân.
- Worker lưu bản dịch cùng output JSON hiện có, không thêm schema SQL. API xem bản tin cũ bổ sung bản dịch khi đọc mà không sửa bản tin lịch sử. Gửi thủ công cũng dùng bản dịch. API và worker có cache trong RAM; cloud dùng cache bền vững qua các lần chạy.
- Dashboard ưu tiên tiếng Việt, ghi “Bản dịch tự động”, mô tả gốc nằm trong phần thu gọn. Push ưu tiên summaryVi và vẫn giữ giới hạn 3900 byte.

## Kiểm chứng

Unit test dùng HTTP fixture cho nhận diện ngôn ngữ, giới hạn UTF-8, cache khôi phục, cache invalidation, concurrent calls, không truyền credential, quota/lỗi/budget/signal, giữ nguyên bản gốc và ưu tiên tiếng Việt trong push. Smoke test API thật đã dịch được mô tả tiếng Anh/Trung, và 5 repository public thật (Gathin23/cleanyourtv, storytold/craft-anything, deepseek-ai/DeepInfer, deepseek-ai/dsh-superagent-prototype, ccch1mneyyy/dsh-Go) sang tiếng Việt. Không gửi thông báo trong unit test.

Tài liệu nhà cung cấp: [API](https://mymemory.translated.net/doc/spec.php), [hạn mức miễn phí](https://mymemory.translated.net/doc/usagelimits.php), [điều khoản](https://mymemory.translated.net/terms-and-conditions). Mức miễn phí ẩn danh hiện công bố là 5000 ký tự/ngày; dịch máy có thể sai thuật ngữ và không bảo đảm uptime.
