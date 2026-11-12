# Kiểm chứng bản tin cloud — 12/11/2026

## Đã triển khai

- Default branch main của CongMinhdesu247/AutomationNEWS có workflow Morning digest (PC off), lịch 00:00 UTC / 07:00 Việt Nam.
- Dùng GitHub-hosted ubuntu-latest, không self-hosted runner, không cần PC hoặc database local.
- Cấu hình cá nhân chuyển qua repository secrets mã hóa HUB_SETTINGS_JSON và NTFY_TOKEN; không commit cấu hình, token hoặc topic thật.
- Chỉ commit các file cloud và thay đổi tùy chọn message trong connector ntfy. Các thay đổi khác có sẵn ở workspace được giữ nguyên, không đưa vào deployment này.

## Kiểm tra cục bộ

- Typecheck API qua.
- 13 cloud test qua. Kiểm tra state CAS, first-run/corrupt/forbidden state, reservation trước POST, lỗi ghi không gửi, same-day deduplication, force-send có chủ đích, dry-run không ghi/gửi, partial source, transient retry và Retry-After, baseline 24h, UTF-8 push limit và cấu hình.
- Checkout riêng từ commit GitHub e0b4b02, chép đúng các file deployment, frozen install: typecheck API và 41 test cloud/connector qua.
- Suite unit trong workspace hiện tại: 74 test qua; các thay đổi bước 6 khác không thuộc commit cloud.

## Kiểm tra GitHub-hosted runner thật

- [Dry-run](https://github.com/CongMinhdesu247/AutomationNEWS/actions/runs/43155275786): success. Cài dependency, typecheck, cloud test và thu thập nguồn thật đều qua; log kết luận dry_run success.
- [Gửi thật](https://github.com/CongMinhdesu247/AutomationNEWS/actions/runs/43155408156): success. Log kết luận sent success.
- State branch hub-cloud-state ghi ngày 2026-11-12, status sent, 200 snapshot repository. ntfy đã trả thành công; việc iPhone thực sự hiển thị cần người dùng quan sát trên thiết bị.
- Tắt newsletter.enabled ở cấu hình local sau khi cloud gửi thành công; giữ cấu hình nguồn và chức năng gửi thủ công. Không thay đổi secret cloud sang trạng thái tắt.
- Không cần mở port/router/tunnel, không thuê server hoặc dùng artifact/cache lưu bản tin.

## Giới hạn

Đã thử workflow_dispatch trên runner thật; chưa chờ lượt schedule tự nhiên sáng 13/11/2026. GitHub có thể trễ/bỏ lịch khi tải cao và tắt schedule public repo sau 60 ngày không hoạt động. Không bảo đảm đúng giây 07:00 hoặc exactly-once push. Sửa settings trong dashboard local không tự cập nhật secret cloud; xem [hướng dẫn](cloud-morning.md).
