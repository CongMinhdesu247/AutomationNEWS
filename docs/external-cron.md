# Lịch miễn phí bên ngoài cho Minh 09:00 và Mẹ 09:30

Cron GitHub có thể bỏ lượt kích hoạt; đổi phút cron không bảo đảm bản tin tới giờ hẹn. Dùng [cron-job.org](https://cron-job.org/en/) để gọi workflow qua API thay cho việc chỉ chờ GitHub cron. GitHub vẫn thực thi lấy dữ liệu/gửi ntfy nên còn thời gian khởi động runner và lấy nguồn; không hứa chính xác từng giây.

## Cấu hình đã chuẩn bị

Tạo **một job** trong cron-job.org, đặt tên `AutomationNEWS — Minh 09:00, Mẹ 09:30`:

- Múi giờ: `Asia/Ho_Chi_Minh`.
- Ngày: mọi ngày. Bộ chạy vẫn kiểm tra ngày được bật của từng hồ sơ.
- Giờ: `09`.
- Phút: `00,05,30,35`. Hai lượt chính là 09:00/09:30; 09:05/09:35 kiểm tra bù khi lượt trước chưa bắt đầu hoặc lỗi trước khi giữ chỗ gửi.
- URL: `https://api.github.com/repos/CongMinhdesu247/AutomationNEWS/actions/workflows/morning-digest.yml/dispatches`.
- Phương thức: `POST`.
- Headers: `Accept: application/vnd.github+json`, `Content-Type: application/json`, `X-GitHub-Api-Version: 2022-11-28`, `Authorization: Bearer <GITHUB_DISPATCH_TOKEN>`.
- Nội dung body:

```json
{
  "ref": "main",
  "inputs": {
    "dry_run": "false",
    "force_send": "false",
    "profile_id": ""
  }
}
```

Không chọn riêng profile và không bật force: lúc 09:00 chỉ hồ sơ đã tới giờ được gửi; lúc 09:30 hồ sơ Mẹ được gửi. Ledger theo hồ sơ/ngày giữ nguyên, nên các lượt bù và cron GitHub còn hoạt động không gửi trùng bản tin. Lượt đã giữ chỗ/gửi thất bại mơ hồ vẫn không được tự ép gửi lại. Các cảnh báo biến động riêng tiếp tục theo luật đã bật.

## Kích hoạt và xác minh

Cần đăng nhập tài khoản cron-job.org để tạo và bật job. Dịch vụ công bố miễn phí; không cần chuyển ứng dụng sang máy chủ trả phí hoặc mua tên miền. Dùng GitHub fine-grained token giới hạn đúng repository, quyền **Actions: write**; nhập trực tiếp vào header của job, không commit token hoặc đưa vào URL. Token này cho dịch vụ cron quyền kích hoạt workflow trong repository; thu hồi token/job sẽ dừng đường kích hoạt này.

Trước khi bật, thử cùng cấu hình với `dry_run: "true"`: mong đợi HTTP 204, workflow xanh và `sent: 0`. Sau đó đổi về `dry_run: "false"`, xem trước các lần chạy kế tiếp và kiểm tra đúng 09:00, 09:05, 09:30, 09:35 theo giờ Việt Nam. Bật thông báo lỗi của cron-job.org để biết nếu GitHub trả lỗi. Không dùng nút Gửi thử với force để kiểm tra chống trùng.

Sau lượt chạy thật, kiểm tra cả **history của job cron**, **event workflow_dispatch trong GitHub Actions** và **delivery sent của từng hồ sơ**. HTTP 204 chỉ xác nhận GitHub nhận yêu cầu, chưa xác nhận ntfy đã gửi. Giữ GitHub cron làm đường dự phòng; chỉ tắt nếu đã xác minh đường mới hoạt động.

Tài liệu nguồn: [cron-job.org: miễn phí, lịch và HTTP tùy chỉnh](https://cron-job.org/en/), [giới hạn và độ chính xác](https://cron-job.org/en/faq/), [GitHub workflow dispatch và quyền token](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

**Trạng thái:** cấu hình đã chuẩn bị trong repository; chưa có job bên ngoài hoạt động cho tới khi được tạo trong tài khoản cron-job.org.
