# Nhận bản tin khi PC tắt

GitHub-hosted runner chạy bản tin theo lịch của từng hồ sơ; không gọi dashboard localhost, không cần PostgreSQL hoặc Docker trên PC. iPhone nhận qua ntfy như trước. Quản lý hồ sơ và đồng bộ cấu hình tại mục **Gia đình**; xem [hướng dẫn gia đình](family-profiles.md). Lịch sử cloud chưa được nhập về dashboard local.

## Kích hoạt chế độ cũ (một người)

1. Đưa workflow `.github/workflows/morning-digest.yml` và code cloud lên default branch của repository GitHub của bạn. Workflow chỉ chạy theo schedule/workflow_dispatch, không chạy khi push hoặc từ pull request.
2. Bật nguồn RSS/thời tiết/GitHub và ntfy trong dashboard, lưu cấu hình. Chạy từ thư mục repository:

```powershell
pnpm --filter @hub/api exec tsx src/cloud/export-local.ts
```

3. File `output/cloud-config.secrets.json` chứa cấu hình cá nhân và token ntfy nếu có. File được gitignore; không chia sẻ/commit. Trong GitHub repository → Settings → Secrets and variables → Actions, tạo **Repository secrets**:
   - `HUB_SETTINGS_JSON`: chuỗi JSON settings bên trong file.
   - `NTFY_TOKEN`: token nếu server cần; có thể để trống khi topic công khai không yêu cầu token.
   Không cần tạo personal access token cho workflow; nó dùng GITHUB_TOKEN tự động của Actions.
4. Actions → **Morning digest (PC off)** → Run workflow. Mặc định dry_run=true: lấy dữ liệu, không gửi hoặc ghi state. Kiểm tra run xanh.
5. Run workflow lần nữa với dry_run=false để nhận một thông báo thật. force_send=false chống gửi lại cùng ngày.
6. Khi nhận được thông báo cloud, tắt **Bật bản tin** trong dashboard cục bộ và lưu để tránh scheduler PC gửi trùng. Không cập nhật secret cloud từ settings đã tắt này, nếu không cloud cũng bị tắt.

Trong chế độ cũ, sửa Cài đặt không tự sửa GitHub Secret. Với chế độ gia đình, **Lưu & đồng bộ** cập nhật secret `HUB_FAMILY_JSON` an toàn ngay từ dashboard; không cần sửa secret thủ công. Khi family secret có mặt, nó là cấu hình có hiệu lực thay cho cấu hình một người cũ.

## Lịch và chi phí

Cron `7,37 * * * *` kiểm tra mỗi 30 phút, ở phút 07 và 37 để tránh đỉnh tải đầu giờ. Bộ chạy lọc hồ sơ đã tới giờ, đúng ngày trong tuần, chưa được thử gửi hôm nay; lịch gửi theo giờ Việt Nam. Cấu hình cũ một người chỉ gửi từ `sendTime` trở đi. Thời gian hồ sơ là mốc sớm nhất được gửi, không bảo đảm đúng phút: còn phụ thuộc lượt kiểm tra kế tiếp và độ trễ của GitHub. GitHub vẫn có thể chạy trễ hoặc bỏ job khi tải cao; đổi phút cron chỉ giảm nguy cơ, không thay thế một bộ lập lịch chạy liên tục. Public repo không hoạt động 60 ngày có thể bị tắt schedule; kiểm tra Actions và bật lại khi cần.

Runner Ubuntu tiêu chuẩn của public repository miễn phí theo điều kiện hiện tại của GitHub. Workflow timeout 7 phút, không tạo artifact/cache trả phí, không thuê server/database. Private repository dùng quota của tài khoản; không tự bật chi tiêu hay runner trả phí.

## Dữ liệu và bảo đảm

- Connector RSS, Open-Meteo, AQI, GitHub, xăng và ntfy dùng chung cho local/cloud. Push tối đa 1.600 byte UTF-8 để chừa chỗ cho dữ liệu FCM/APNS và metadata. Nếu cần rút gọn, vẫn giữ 3 tiêu đề RSS/5 repo, cắt ngắn tóm tắt và bỏ link phụ trong push; nội dung và link đầy đủ vẫn có trong dashboard local. Không gắn link localhost.
- Read transient lỗi được thử thêm tối đa 2 lần, có jitter; không retry trước Retry-After/reset. Hint lớn hơn 20 giây được để thành lỗi nguồn để vẫn gửi bản tin một phần trong thời gian hữu hạn. POST ntfy không tự retry khi không rõ kết quả.
- Branch orphan `hub-cloud-state` lưu ID repository/số sao/thời gian snapshot, giá RON 95 công khai của lần gửi thành công trước, trạng thái gửi theo ngày và cache bản dịch tiếng Việt của mô tả repository công khai (tối đa 150 mục/30 ngày). Không lưu tọa độ, topic, settings, bản tin hoặc token. Nhánh này công khai nếu repository công khai. Head giữ snapshot 3 ngày và tối đa 4000 mục, delivery/baseline giá xăng 14 ngày; Git history vẫn giữ phiên bản cũ.
- Snapshot gần 24 giờ trong cửa sổ 20–28 giờ để tính tăng sao; ngày đầu hoặc lịch bị trễ quá cửa sổ dùng dự án mới đáng chú ý, không bịa tăng sao.
- Workflow concurrency tuần tự và state CAS tránh ghi đè. Ghi reserved trước khi gửi; nếu ghi state lỗi thì không POST. Ngày đã reserved/sent/failed/unknown không tự gửi lại. Có thể mất thông báo nếu crash giữa reserved và POST; không hứa exactly-once.
- Nếu run đỏ, xem state delivery và kiểm tra điện thoại. Chỉ bật force_send=true khi chủ động muốn thử gửi lại (có thể trùng). Dry-run không làm thay đổi ledger/snapshot.
- GITHUB_TOKEN chỉ có contents:write để cập nhật nhánh dữ liệu; credential checkout không giữ trong Git config, actions pin commit SHA. Không log secret hoặc nội dung bản tin vào log public. Không upload bản tin vào artifact.

## Tạm dừng / quay lại local

Disable workflow trong Actions để dừng cloud. Muốn quay lại local, dừng cloud trước rồi bật Bản tin trong dashboard. Không xóa nhánh state nếu chưa hiểu tác dụng: xóa ledger có thể khiến gửi lại trong cùng ngày và mất baseline sao.

## Kiểm tra

```powershell
pnpm --filter @hub/api typecheck
pnpm exec vitest run apps/api/src/cloud/cloud.test.ts
```

Tài liệu chính thức: [scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [repository secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
