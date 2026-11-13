# Checklist ba buổi sáng thực tế — v1.0.0

**Chưa thực hiện: 0/3 buổi sáng được xác nhận.** Đây là checklist cho chủ dự án, không phải kết quả test tự động hoặc lịch nhắc đã được tạo.

## Chuẩn bị một lần

- [ ] Chọn ba ngày liên tiếp, giờ gửi và múi giờ thực tế (ví dụ 07:00 Asia/Ho_Chi_Minh). Không thay giờ chỉ để giả lập đã qua ba sáng.
- [ ] Áp dụng source đã xem xét vào môi trường sử dụng riêng; kiểm tra migration, API ready, worker và scheduler đang chạy.
- [ ] Chọn RSS công khai hợp lệ, địa điểm/tọa độ và topic/language GitHub của mình; lưu đủ cấu hình. Không dùng URL .fixture.invalid hoặc bản DEMO FIXTURE.
- [ ] Bật ntfy với server/topic của mình, điện thoại đã subscribe; token nếu có chỉ ở backend .env. Chủ dự án đồng ý nhận thông báo thật trước khi bật lịch.
- [ ] Máy thức, Docker/worker/scheduler còn chạy, đồng hồ đúng và có Internet từ trước giờ gửi. Nếu ngủ/tắt quá grace 15 phút mặc định, hệ thống bỏ lượt cũ; không coi đó là đã nghiệm thu thành công.
- [ ] Có backup trước khi áp dụng bản mới. Không xóa volume hay dọn dữ liệu để làm đẹp kết quả.
- [ ] Ghi kết quả riêng tại `output/morning-checks/` (được gitignore), không commit URL/topic riêng, tọa độ cá nhân, log, token hoặc ảnh chứa thông tin điện thoại.

## Buổi sáng 1 — nguồn thật và lịch

Ngày dự kiến: __________  Giờ/múi giờ: __________

- [ ] Không bấm Tạo bản tin ngay quanh giờ lịch; xác nhận scheduler tự tạo đúng một scheduled run cho ngày địa phương.
- [ ] Ghi run ID, giờ dự kiến/thực tế bắt đầu, giờ kết thúc và digest ID trong ghi chú riêng.
- [ ] RSS chỉ có bài trong 24 giờ, plain text, không trùng tracking; nguồn không có tin mới được hiển thị đúng thay vì bịa nội dung.
- [ ] Thời tiết đúng ngày theo timezone; thiếu trường giữ trạng thái thiếu/null. Có attribution và gợi ý ô nếu xác suất mưa đạt ngưỡng.
- [ ] GitHub không tự nhận là Trending chính thức; chưa có baseline thì dùng dự án mới, không gán tăng sao giả.
- [ ] Điện thoại thực sự nhận một push ngắn. So sánh với notification attempt và outbox; HTTP success đơn thuần không chứng minh điện thoại đã nhận.
- [ ] Nếu có nguồn lỗi, ghi nguyên nhân đã làm sạch và chất lượng partial/failed; bản tin/lịch sử vẫn xem được.
- [ ] Reload rồi restart ứng dụng theo cách dừng giữ volume; cấu hình và bản tin còn nguyên. Không khởi tạo volume khác để thay thế kết quả cũ.

Kết quả: Đạt / Chưa đạt / Bị điều kiện môi trường chặn. Ghi chú riêng: __________

## Buổi sáng 2 — chạy lặp và telemetry

Ngày dự kiến: __________  Cùng múi giờ/cấu hình quan tâm ngày 1: Có / Không

- [ ] Scheduled run mới có ID riêng và chỉ một run theo lịch cho ngày này; lịch sử ngày 1 không bị thay.
- [ ] Theo dõi trang run từ queued/running tới terminal. Timeline phản ánh trạng thái node và thời gian thật.
- [ ] Ngắt mạng trình duyệt tạm thời rồi kết nối lại khi run đang chạy; backend vẫn chạy. Giao diện báo reconnect và nhận bù event, không có dòng trùng/mất liên kết bản tin.
- [ ] Reload trong hoặc sau run vẫn xem được state và timeline còn lưu. Không suy rằng toàn bộ event tồn tại mãi sau retention.
- [ ] Push trên điện thoại chỉ xuất hiện một lần cho lượt lịch; không bấm gửi lại nếu outbox unknown trước khi kiểm tra điện thoại.
- [ ] Ghi lỗi quota, nguồn không có dữ liệu hoặc chênh lệch múi giờ nếu xảy ra. Không cố tình làm hỏng API nguồn hoặc kill worker production để điền checklist.

Kết quả: Đạt / Chưa đạt / Bị điều kiện môi trường chặn. Ghi chú riêng: __________

## Buổi sáng 3 — dữ liệu nền và bền vững

Ngày dự kiến: __________  Giờ thực tế lấy GitHub: __________

- [ ] Run/bản tin ngày mới cùng lịch sử hai ngày trước vẫn tồn tại; cấu hình không bị seed/migrate ghi đè.
- [ ] Với repository còn trong tập ứng viên, nếu có snapshot 20–28 giờ thì kiểm tổng sao, baselineAt và intervalHours. Chênh lệch âm hoặc 0 là hợp lệ; không thay thành số tăng dương.
- [ ] Nếu không có repository đủ baseline (quota/đổi tập ứng viên/lệch giờ), ghi rõ “chưa xác minh baseline live”, không đánh dấu đã qua chỉ vì fixture test đã qua.
- [ ] Kiểm tra lịch timezone, RSS/ngày thời tiết, SSE/reload và một push thật như hai buổi trước.
- [ ] Tạo backup và restore vào DB mới bằng hướng dẫn operations, không restore đè DB đang dùng hoặc chạy outbox backup tới điện thoại.
- [ ] Tổng kết ba ngày: số run theo lịch, số điện thoại nhận, số nguồn thành công/lỗi, incident và giới hạn. Chỉ cập nhật release-readiness/CV với bằng chứng đã làm sạch.

Kết quả: Đạt / Chưa đạt / Bị điều kiện môi trường chặn. Ghi chú riêng: __________

## Quy tắc kết luận

Chỉ đánh dấu 3/3 khi ba buổi sáng thực tế có bằng chứng lịch/run/bản tin/push theo đúng kỳ vọng. Nếu máy tắt hoặc Internet mất thì ghi lại và thử thêm ngày khác, không sửa timestamp để bù. Nguồn ngoài không có tin hoặc trả lỗi được coi là xử lý đúng khi hệ thống phản ánh trung thực, nhưng không được dùng để kết luận tích hợp đó đã lấy dữ liệu thành công. GitHub baseline live có thể vẫn chưa xác minh dù các mục khác đạt.

Retry/DLQ và kill worker đã được kiểm chứng bằng test PostgreSQL/fixture. Demo phục hồi và quay video dùng môi trường demo riêng, không cần gây crash trên dữ liệu cá nhân để hoàn thành ba sáng.
