# Tiện ích buổi sáng

Trong **Tùy chọn bản tin → Tiện ích buổi sáng**, mỗi tài khoản có thể bật riêng:

- **Việc cần làm hôm nay:** thêm tối đa 20 việc với tên và ngày cần làm. Bản tin lấy những việc chưa hoàn thành, đến hạn hôm nay hoặc quá hạn theo múi giờ bản tin. Đánh dấu hoàn thành hoặc xóa rồi **Lưu lựa chọn**. Đây là nhắc việc trong bản tin theo lịch gửi, không phải báo thức riêng từng việc.
- **Ngày lễ & kỷ niệm:** ba ngày cố định theo dương lịch Việt Nam sắp tới, kèm số ngày còn lại. Danh mục gồm Tết Dương lịch, 8/3, 30/4, 1/5, 1/6, 2/9, 20/10 và 20/11. Chưa có lịch âm/Tết Âm lịch, ngày nghỉ bù hay kỷ niệm tự nhập; danh mục không thay thế lịch nghỉ chính thức.
- **Chỉ số UV:** dự báo UV tối đa trong ngày từ [Open-Meteo](https://open-meteo.com/en/docs), theo thành phố đã chọn. Hoạt động độc lập với ô Thời tiết. Dữ liệu thiếu hoặc nguồn lỗi được báo rõ; giá trị 0 vẫn hợp lệ.

Các mục mới mặc định tắt; không thay đổi lựa chọn đang lưu của tài khoản cũ. Có thể tạo bản tin chỉ gồm các tiện ích này, không cần bật RSS hay thời tiết. Bản tin đã tạo là ảnh chụp dữ liệu tại thời điểm chạy: sau khi sửa việc, cần tạo bản tin mới để thấy thay đổi. Nội dung cũng được đưa vào thông báo bản tin, với bản tóm tắt tối đa ba việc và ngày kỷ niệm gần nhất.

Việc cá nhân được lưu trong cấu hình tài khoản PostgreSQL; API lịch sử và bản tin kiểm tra chủ sở hữu. Không đồng bộ với lịch Google và không gọi dịch vụ bên ngoài cho việc/ngày lễ. Không cần migration mới vì cấu hình tài khoản dùng JSON đã được kiểm tra bằng schema.

Kiểm tra tự động bao gồm ngày đến hạn theo múi giờ, việc đã hoàn thành, chuyển năm của lịch, UV bằng 0/thiếu dữ liệu, bản tin chỉ bật tiện ích, cách ly giữa tài khoản và nội dung thông báo. Kiểm tra trình duyệt dùng `tests/accounts/server.ts` với dữ liệu giả lập riêng, không gửi thông báo thật.
