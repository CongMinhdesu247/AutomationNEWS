# Nội dung bản tin và vàng miếng SJC

Từ bản cập nhật này, mục vàng chỉ dùng **vàng miếng SJC**: lấy giá hiện tại, lịch sử, đáy 30 ngày, cảnh báo, dashboard và thông báo. Không tải lịch sử vàng nhẫn. Bản ghi cũ được giữ nguyên trong database để không mất lịch sử, nhưng vàng nhẫn được lọc khi hiển thị/gửi lại và không kích hoạt cảnh báo mới. Một giá vàng miếng hợp lệ đã là dữ liệu đầy đủ, không bị đánh partial vì thiếu nhẫn.

Các chủ đề bổ sung cho tài khoản và hồ sơ gia đình:

| Chủ đề | RSS VnExpress |
| --- | --- |
| Sức khỏe | suc-khoe.rss |
| Du lịch | du-lich.rss |
| Giải trí | giai-tri.rss |
| Thế giới | the-gioi.rss |
| Pháp luật | phap-luat.rss |
| Ô tô & xe máy | oto-xe-may.rss |
| Bất động sản | bat-dong-san.rss |

Nguồn và địa chỉ feed được đối chiếu với [danh mục RSS chính thức](https://vnexpress.net/rss). Đây là nội dung tin tức có link nguồn, không phải một dịch vụ tư vấn hoặc dữ liệu giá chuyên ngành mới. Khi kiểm tra trực tiếp, năm feed trả XML có bài; Sức khỏe và Thế giới gặp timeout tại lần kiểm tra. Chúng vẫn là URL trong danh mục chính thức, không thay bằng dữ liệu giả.

Mở **Tùy chọn bản tin → Chủ đề tin tức**, chọn mục và lưu. Tổng danh mục là 13 chủ đề; API tài khoản cho phép tối đa 16 feed. Không tự bật nội dung mới cho người dùng hiện có. Bản tin tiếp tục lấy bài trong 24 giờ và tối đa 10 bài tổng cộng, khử trùng URL. Nếu chọn nhiều nhóm, không đảm bảo mỗi nhóm có một bài trong giới hạn 10 bài.

Các hồ sơ gia đình dùng workflow cloud cần triển khai cùng phiên bản source trước khi đồng bộ các khóa chủ đề mới. Bộ Docker local đã được cập nhật riêng; thay đổi này không tự cập nhật repository hoặc máy chủ từ xa.
