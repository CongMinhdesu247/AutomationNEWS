# Đưa AutomationNEWS lên HP EliteDesk / Ubuntu Server

> Cập nhật 15/11/2026: chủ dự án xác nhận ứng dụng đã public. Các bước Pending/Quick Tunnel/khởi tạo dưới đây là tài liệu lịch sử; không áp dụng lại mù cho server đang chạy. Phát hành Premium dùng [runbook cập nhật có backup và rollback](premium-release.md), giữ project/network/volume/domain/tunnel thực tế. Cấu hình và tài nguyên HP chưa được đo lại trong tác vụ local này.

Bản này dùng tài khoản PostgreSQL, phiên đăng nhập bằng cookie HttpOnly, cấu hình/lịch/lịch sử riêng. Web, API, worker và scheduler tiếp tục dùng Docker Compose. Không cần máy Windows bật sau khi triển khai.

Máy đích: Ubuntu Server 24.04 x86_64, Docker Engine + Compose. Dùng thư mục `/opt/automationnews` (hoặc `~/apps/AutomationNEWS`), Compose project **automationnews**, web **127.0.0.1:8091**, volume **automationnews_hub_data**. Các dịch vụ khác trên cùng máy chủ và cấu hình tunnel riêng của chúng được giữ nguyên độc lập.

## 1. Chuyển source từ Windows

Trong PowerShell tại repository:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-home.ps1
scp -i "$env:USERPROFILE\.ssh\id_ed25519" output/automationnews-home.tar.gz <ssh-user>@<server-tailscale-ip>:~/
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" <ssh-user>@<server-tailscale-ip>
```

Máy chạy các lệnh này phải có Tailscale (hoặc mạng quản trị riêng) và khóa SSH được cho phép. Gói source không chứa `.env`, secret, node_modules hoặc dữ liệu database.

Các lệnh còn lại chạy trong SSH Ubuntu:

```bash
mkdir -p ~/apps/AutomationNEWS
cd ~/apps/AutomationNEWS
tar -xzf ~/automationnews-home.tar.gz
umask 077
cp -n .env.home.example .env.home
mkdir -p secrets
chmod 700 secrets
nano .env.home
```

Đặt `POSTGRES_PASSWORD` ngẫu nhiên chỉ gồm chữ và số, `OWNER_EMAIL` là email quản trị. Có thể tạo mật khẩu database bằng `openssl rand -hex 24`, tự điền vào `.env.home`; không gửi mật khẩu vào chat. Giữ `REGISTRATION_OPEN=false` đến khi quản trị viên đã đăng nhập và kiểm tra xong.

`APP_ORIGIN` là **đúng origin HTTPS người dùng mở**, không có đường dẫn hoặc dấu `/` cuối (ví dụ `https://news.example.com`). Có thể dùng Quick Tunnel riêng ở bước 3A trong lúc chờ DNS hoạt động.

```bash
chmod 600 .env.home
docker compose -p automationnews --env-file .env.home -f infra/compose.yaml -f infra/compose.home.yaml config --quiet
docker compose -p automationnews --env-file .env.home -f infra/compose.yaml -f infra/compose.home.yaml up -d --build --wait db api worker scheduler web
curl --fail http://127.0.0.1:8091/api/ready
```

Không xuất database/API ra Internet. Cổng 8091 chỉ bind loopback; truy cập public qua tunnel. Không dùng `docker compose config` không có `--quiet` khi chia sẻ log vì bản render có thể chứa secret.

## 2. Tạo quản trị viên

Không có quy tắc “người đăng ký đầu tiên là admin”. Tạo admin bằng lệnh trên server, với mật khẩu một lần qua file:

```bash
read -rsp 'Mật khẩu quản trị (12–128 ký tự): ' owner_password; printf '\n'
printf '%s' "$owner_password" > secrets/owner_password
unset owner_password
chmod 644 secrets/owner_password
docker compose -p automationnews --env-file .env.home -f infra/compose.yaml -f infra/compose.home.yaml run --rm --build owner
rm -f secrets/owner_password
```

File có quyền 644 để user `node` trong container đọc được kể cả UID host khác; thư mục cha `secrets` có quyền 700. File chỉ được mount vào container công cụ owner, không mount vào API/worker. Xóa file sau khi dùng. Lệnh owner có thể chạy lại để đặt lại mật khẩu admin, đồng thời thu hồi phiên cũ.

Đăng nhập bằng `OWNER_EMAIL` và mật khẩu vừa đặt sau khi đã có đúng public origin. Nếu khôi phục mật khẩu **thành viên**, tạo lại file mật khẩu rồi chạy lệnh sau, thay email đích; thao tác này không nâng quyền:

```bash
OWNER_EMAIL='member@example.com' ACCOUNT_ACTION=reset-password docker compose -p automationnews --env-file .env.home -f infra/compose.yaml -f infra/compose.home.yaml run --rm --build owner
rm -f secrets/owner_password
```

Chưa có xác minh email hoặc reset password qua email. Giai đoạn đầu nên mở đăng ký cho nhóm nhỏ. Email hiện là định danh đăng nhập, chưa phải email đã xác minh.

## 3A. Thử bằng Quick Tunnel riêng, khi tên miền còn Pending

```bash
docker compose -p automationnews --env-file .env.home -f infra/compose.yaml -f infra/compose.home.yaml --profile quick up -d quick-tunnel
docker compose -p automationnews --env-file .env.home -f infra/compose.yaml -f infra/compose.home.yaml logs --tail=60 quick-tunnel
```

Lấy origin `https://....trycloudflare.com` từ log, điền vào `APP_ORIGIN` trong `.env.home`, sau đó:

```bash
docker compose -p automationnews --env-file .env.home -f infra/compose.yaml -f infra/compose.home.yaml up -d --no-deps api scheduler
```

Không restart quick-tunnel khi cập nhật origin. Nếu tunnel restart và URL đổi, phải cập nhật origin và recreate API/scheduler lại. Cookie Secure chỉ hoạt động khi truy cập HTTPS; mở thẳng `http://127.0.0.1:8091` chỉ dùng healthcheck, không dùng để đăng nhập khi `APP_ORIGIN` là HTTPS.

Quick Tunnel không có cam kết uptime, giới hạn request đang xử lý và **không hỗ trợ SSE**. Màn hình tiến độ có nút Tải lại; dùng nút này khi thử qua Quick Tunnel. Chỉ dùng tạm để nghiệm thu; production dùng named tunnel. [Tài liệu chính thức](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## 3B. Named Tunnel với tên miền riêng

Sau khi nhà cung cấp hoàn tất đăng ký:

1. Thêm zone tên miền của bạn (ví dụ `example.com`) vào Cloudflare và làm theo hướng dẫn đổi nameserver tại nhà đăng ký. Chờ zone Active.
2. Trong Cloudflare tạo **Cloudflare Tunnel** dành riêng cho AutomationNEWS. Chọn connector Docker, lấy token; không dán token vào chat hoặc commit.
3. Thêm published application route: hostname `news.example.com`, service **HTTP `web:80`**. Đây là tên service trong mạng Compose của app. Không override HTTP Host Header.
4. Lưu token trên server bằng lệnh dưới.

```bash
read -rsp 'Cloudflare tunnel token: ' tunnel_token; printf '\n'
printf '%s' "$tunnel_token" > secrets/cloudflare_tunnel_token
unset tunnel_token
chmod 644 secrets/cloudflare_tunnel_token
```

Token chỉ mount vào container tunnel; thư mục cha `secrets` giữ 700. Cập nhật `APP_ORIGIN=https://news.example.com` trong `.env.home` rồi:

```bash
docker compose -p automationnews --env-file .env.home -f infra/compose.yaml -f infra/compose.home.yaml up -d --no-deps api scheduler
docker compose -p automationnews --env-file .env.home -f infra/compose.yaml -f infra/compose.home.yaml --profile tunnel up -d tunnel
curl --fail https://news.example.com/api/ready
```

Khi named tunnel đã hoạt động, dừng **quick-tunnel của AutomationNEWS**:

```bash
docker compose -p automationnews --env-file .env.home -f infra/compose.yaml -f infra/compose.home.yaml stop quick-tunnel
```

Cloudflare Tunnel dùng kết nối outbound nên không cần IP public, mở port 80/443 hay biết mạng có CGNAT. Không cần triển khai thêm Caddy khi dùng phương án này. [Cơ chế Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/), [hướng dẫn thiết lập](https://developers.cloudflare.com/tunnel/get-started/).

Nếu dùng Cache Rules trên Cloudflare, bypass cache cho `/api/*`; không bật Cache Everything trên API. Không đưa Cloudflare Access chặn toàn bộ hostname nếu muốn người ngoài tự đăng ký bằng tài khoản của ứng dụng.

## 4. Nghiệm thu rồi mở đăng ký

- Dùng 4G/5G mở public URL, đăng nhập admin.
- Bật nguồn trong Tùy chọn bản tin, lưu, tạo bản tin, mở kết quả, đăng ký topic ntfy trên điện thoại rồi gửi thử. Đích ntfy do server cấp; thành viên không chỉnh server/topic để tránh gửi token chung tới đích khác.
- Bật lịch, chọn ngày/giờ/múi giờ, kiểm tra lần gửi tiếp theo. Server cần chạy liên tục; lịch trễ hơn `SCHEDULER_GRACE_MS` sẽ bỏ qua thay vì gửi bản tin cũ.
- Tạo hai tài khoản qua hai trình duyệt; mỗi người chỉ thấy cấu hình và lịch sử của mình. Thử copy URL bản tin từ tài khoản A sang B: phải không đọc được.
- Trong Thành viên, admin có thể khóa/mở khóa tài khoản. Khóa thu hồi phiên và dừng lịch mới; lần gửi đang thực hiện có thể đã tới ntfy.
- Đặt `REGISTRATION_OPEN=true` khi sẵn sàng, rồi recreate riêng API bằng `up -d --no-deps api`. Mặc định tối đa 100 tài khoản, 10 bản tin thủ công/ngày/tài khoản, 5 lần gửi thủ công/giờ/tài khoản. Đây là giới hạn sử dụng, chưa phải kết quả benchmark tải 100 người.
- Khởi động lại stack có chủ đích, kiểm tra cấu hình còn và lịch vẫn chạy. Nghiệm thu thực tế ít nhất một buổi sáng trên điện thoại.

Thông báo dùng ntfy; topic ngẫu nhiên cần giữ kín. Nếu yêu cầu kiểm soát người đăng ký topic, triển khai ntfy có xác thực và ACL. App chưa cấp thông tin xác thực ntfy riêng theo người dùng, chưa có email push hay Web Push. Cảnh báo vàng/USD ngoài lịch trong luồng legacy không tự trở thành cảnh báo riêng cho các tài khoản mới; phạm vi mới là bản tin định kỳ.

## 5. Dữ liệu cũ, backup và nâng cấp

Migration 010 thêm bảng/cột, không xóa cấu hình, bản tin hay hồ sơ gia đình cũ. Màn hình quản trị vẫn có các công cụ legacy. Các hồ sơ gia đình không tự chuyển thành tài khoản; liên kết thành viên cũ không dùng thay đăng nhập trong entry point mới.

Tài khoản admin được copy cấu hình cá nhân một lần, **tắt lịch của tài khoản mới** để tránh gửi song song với lịch legacy. Nếu trước đó đã dùng lịch legacy/cloud, chuyển từng lịch có chủ đích và tắt lịch cũ trước khi bật lịch tài khoản. `CLAIM_LEGACY_DATA=true` chỉ dùng khi chắc chắn toàn bộ dữ liệu chưa có chủ thuộc admin này; chạy owner sẽ gán lịch sử đó cho admin. Mặc định không gán, vẫn xem được trong quản trị.

Database mới dùng volume riêng. Khi cập nhật server đã có dữ liệu, giữ `.env.home`, `secrets` và volume. Backup trước migration:

```bash
mkdir -p backups
chmod 700 backups
docker compose -p automationnews --env-file .env.home -f infra/compose.yaml -f infra/compose.home.yaml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/hub-$(date +%Y%m%d-%H%M%S).dump"
```

Lưu bản backup mã hóa ở vị trí khác máy chủ theo hệ thống backup sẵn có. Backup database chứa hash mật khẩu, phiên đăng nhập và cấu hình người dùng; không chia sẻ công khai.

Khi nâng cấp: backup → giải nén source mới (không chép đè file môi trường) → stop `web api worker scheduler` của project **automationnews** → `up -d --build --wait db api worker scheduler web`. Giữ tunnel đang chạy để hostname ổn định; người dùng có thể gặp lỗi tạm trong thời gian nâng cấp. Nếu build lỗi, giữ volume và triển khai lại source trước; không down migration và không `down -v`. Migration 010 giữ tương thích các cột legacy, nhưng source trước đây **không có bảo vệ tài khoản**: không rollback API cũ trong khi tunnel vẫn public; dừng tunnel trước nếu buộc rollback.

Xem container bằng `docker compose ... ps`; chỉ chia sẻ log đã bỏ token/email. Không chạy `docker system prune`, không xóa volume và không can thiệp các dự án khác chạy cùng máy chủ.

## Trạng thái nghiệm thu mẫu

Sau khi triển khai qua SSH/Tailscale vào thư mục `~/apps/AutomationNEWS` (Compose project `automationnews`, web bind `127.0.0.1:8091`), kiểm tra các bước:
- Build, migration, database/API/web healthcheck đạt; worker và scheduler đang chạy.
- Đăng nhập quản trị bằng `OWNER_EMAIL` đã cấu hình và mật khẩu khởi tạo trong `secrets/owner_password` (xóa file `secrets/owner_password` ngay sau lần đổi mật khẩu đầu tiên).
- Thiết lập lịch backup tự động/offsite cho thư mục `backups` (quyền 700) và kiểm tra phục hồi thử định kỳ trên database riêng biệt.
