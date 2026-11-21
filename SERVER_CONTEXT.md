# SERVER_CONTEXT.md — Hồ sơ Local Server cho AutomationNEWS

> **Ghi chú vận hành:** Tệp này mô tả kiến trúc thực tế của máy chủ tại nhà đang chạy dự án **AutomationNEWS** cùng các ứng dụng anh em. Không lưu bất kỳ mật khẩu, token hay API key dạng rõ nào trong tệp này — mọi biến nhạy cảm đặt trong `.env.home`, `.env.premium` và `secrets/` trên server với quyền `600`/`700`.

---

## 1. Thông tin hệ thống & Kết nối SSH

- **Hệ điều hành (OS):** `Ubuntu Server 24.04.5 LTS (noble)` — Hostname: `homeserver`
- **Kiến trúc CPU:** `x86_64 (amd64)`
- **Phần cứng:** `HP EliteDesk 800 G4 SFF (Intel Core i7-8700 6 nhân/12 luồng, 8 GB RAM + 4 GiB Swap, 500 GB WDC HDD /dev/sda2, Ethernet eno1)`
- **Địa chỉ IP Tailscale (ưu tiên cho SSH & backup):** `100.95.33.63` (PC quản trị: `100.79.91.52`)
- **Địa chỉ IP LAN (DHCP):** `192.168.100.186` (Gateway: `192.168.100.1`)
- **Khóa SSH trên PC Windows:** `C:\Users\Dung\.ssh\homeserver_ed25519` (có passphrase, không sao chép vào repo/container)
- **Lệnh SSH chuẩn từ PC Windows:** `ssh -i "$env:USERPROFILE\.ssh\homeserver_ed25519" congminh@100.95.33.63`
- **User deploy:** `congminh` (sử dụng `sudo` khi cần thao tác hệ thống / UFW)
- **Múi giờ:** `Asia/Ho_Chi_Minh (UTC+7)`

---

## 2. Cấu trúc thư mục trên Server

Hệ thống tuân thủ chuẩn tách biệt hoàn toàn từng dự án dưới `/home/congminh/apps/`. Script cập nhật `scripts/server-update.sh` tự động nhận diện cả **bố cục hiện hữu** (`~/apps/AutomationNEWS/` trực tiếp) lẫn **bố cục chuẩn mở rộng** (`~/apps/AutomationNEWS/source/`):

```text
/home/congminh/apps/
├── _proxy/                           # Cấu hình Reverse Proxy / Cloudflare Tunnel dùng chung
│   ├── docker-compose.yml            # (Tùy chọn nếu gom proxy tập trung)
│   └── sites/                        # Vhost / route riêng từng dự án (mẫu sẵn trong infra/proxy/)
│       ├── automationnews.nginx.conf
│       └── automationnews.caddy
├── BankingPrj/                       # Ứng dụng anh em (project banking-local, 127.0.0.1:8090) — TUYỆT ĐỐI KHÔNG CHẠM
└── AutomationNEWS/                   # Không gian riêng của dự án Bản tin mỗi sáng (project automationnews, 127.0.0.1:8091)
    ├── infra/                        # Dockerfile, compose.yaml, compose.home.yaml, nginx.conf, proxy/
    ├── apps/ & packages/ & db/       # Source code (hoặc đặt trong ./source/ nếu tách thư mục code)
    ├── docker-compose.server.yml     # File chạy chuẩn ở thư mục gốc dự án
    ├── .env.home                     # Biến môi trường production chính (chmod 600, KHÔNG commit)
    ├── .env.premium                  # Khóa Gemini & Brave Search tách riêng (chmod 600, tùy chọn)
    ├── secrets/                      # Token Cloudflare Tunnel & mật khẩu khởi tạo owner (chmod 700)
    └── data/                         # Dữ liệu bền vững ngoài container (chmod 700)
        └── backups/                  # Bản sao lưu pg_dump + SHA256 tự động trước mỗi lần cập nhật
```

- **Đường dẫn gốc chứa các dự án:** `/home/congminh/apps`
- **Thư mục dự án AutomationNEWS:** `/home/congminh/apps/AutomationNEWS`
- **Compose Project & Volume:** Project `automationnews` · Volume PostgreSQL hiện hữu `automationnews_hub_data` (giữ nguyên 100% dữ liệu qua các bản cập nhật) + thư mục sao lưu bền vững `./data/backups/` trên host.
- **Đường dẫn lưu log:** Quản lý qua Docker `json-file` xoay vòng tự động (`max-size: 10m`, `max-file: 3`) cho toàn bộ container để không bao giờ tràn ổ SSD.

---

## 3. Cách đưa Web/App ra Internet công khai (Public Exposure)

- **Tên miền công khai:** Khai báo chính xác trong biến `APP_ORIGIN` của `.env.home` (ví dụ `https://news.<tenmiencuaban>.com`, không có dấu `/` ở cuối).
- **Phương thức public ra ngoài:** `Cloudflare Tunnel (cloudflared)` (hỗ trợ song song chạy qua profile `--profile tunnel` nội bộ hoặc qua `_proxy` dùng chung của server).
- **Reverse Proxy nội bộ ứng dụng:** Container `web` (`nginx:stable-alpine`) lắng nghe cổng `80` nội bộ và chỉ bind ra loopback máy chủ tại `127.0.0.1:8091:80`.
- **SSL / HTTPS:** `Tự động qua Cloudflare Edge TLS` (hoặc `Let's Encrypt` nếu dùng Caddy/Nginx ở `_proxy`).

### Quy tắc URL, Origin & Proxy đã cấu hình sẵn trong code
- Frontend gọi API theo đường dẫn tương đối cùng origin (`/api/...`), **không** hardcode `localhost:3000` hay `localhost:3001`.
- Nginx (`infra/nginx.conf`) giữ nguyên `X-Forwarded-Proto` từ Cloudflare/`_proxy` (`map $http_x_forwarded_proto $forwarded_proto`) và phân tách rate-limit/SSE theo từng IP người dùng thực (`CF-Connecting-IP` / `X-Forwarded-For` từ dải proxy tin cậy).
- Backend Fastify (`apps/api/src/server.ts`) bật `trustProxy` giới hạn đúng dải loopback & mạng nội bộ Docker (`TRUSTED_PROXY_CIDRS`), kiểm tra chặt `Origin === APP_ORIGIN` và đặt cookie phiên `__Host-hub_session` (`Secure; HttpOnly; SameSite=Lax`).

---

## 4. Môi trường chạy & Công cụ trên Server

- **Containerization:** `Docker Engine + Docker Compose v2` (toàn bộ 5 tiến trình `db`, `migrate`, `api`, `worker`, `scheduler`, `web` đóng gói multi-stage trên `node:24-alpine`, `postgres:17-alpine`, `nginx:stable-alpine`).
- **Tự phục hồi & Giới hạn tài nguyên:**
  - Mọi service dài hạn đều đặt `restart: unless-stopped`, `security_opt: ["no-new-privileges:true"]`, và `mem_limit` rõ ràng (`db: 512m`, `api: 512m`, `worker: 512m`, `scheduler: 384m`, `web: 128m`).
  - Healthcheck thực chất cho cả 4 tầng: `pg_isready` (`db`), `/api/ready` (`api`), heartbeat file `< 60s` (`worker` & `scheduler`), và `/api/health` qua Nginx (`web`).
- **Database:** `PostgreSQL 17` chạy riêng trong project `automationnews` (không dùng chung để tránh ảnh hưởng chéo schema/migration `001`–`018`).
- **Firewall trên server:** `UFW bật` (chỉ mở SSH `22` nội bộ/Tailscale; cổng ứng dụng `8091` chỉ lắng nghe trên `127.0.0.1`, không mở cổng thô `0.0.0.0`).

---

## 5. Bảng phân bổ Port & Tên miền (Tránh xung đột)

| Dự án | Loại (Web/API/DB) | Port nội bộ (Host Loopback) | Container Target | Subdomain / URL công khai | Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `_proxy` / `cloudflared` | Reverse Proxy / Tunnel | `80 / 443` (hoặc outbound Tunnel) | — | Quản lý tập trung | Đang chạy |
| `banking-local` | Web/App anh em | `127.0.0.1:8090` | `:80` | Nội bộ / Riêng | **Đang chạy (Không đụng)** |
| **`AutomationNEWS`** | Fullstack + Worker + Cron + PG17 | **`127.0.0.1:8091`** | `web:80` -> `api:3001` | Theo `APP_ORIGIN` trong `.env.home` | **Đang chạy (Cập nhật tại chỗ)** |
| `AutomationNEWS` (Family Link tùy chọn) | Cổng chỉ đọc cho người thân | `127.0.0.1:8092` (khi bật `family-access.yaml`) | `member-web:80` | Theo `MEMBER_PUBLIC_URL` | Tùy chọn |

- **Dải port quy ước cho các app tiếp theo:** `127.0.0.1:8093 - 8099`.
- **Quy tắc bất biến:** Luôn bind `127.0.0.1:${WEB_PORT:-8091}:80`. Container `web` giữ cổng nội bộ `:80` để tương thích 100% với route Cloudflare Tunnel hiện có (`http://web:80`) cũng như route từ host (`http://127.0.0.1:8091`).

---

## 6. Quy trình Cập nhật (Incremental Update) từ PC lên Local Server

Dự án **đã tồn tại sẵn trên server** tại `/home/congminh/apps/AutomationNEWS`. Tuyệt đối không xóa thư mục dự án, không ghi đè `.env.home`/`.env.premium` và không chạy `docker compose down -v`.

### Cách 1: Cập nhật tự động 1 lệnh từ Windows PowerShell (Khuyên dùng)

Script `scripts\update-local-server.ps1` đã được cấu hình mặc định trỏ tới `congminh@100.95.33.63` (Tailscale IP của máy HP `homeserver`) kèm khóa `$env:USERPROFILE\.ssh\homeserver_ed25519` và truyền gói cập nhật qua **1 phiên SSH duy nhất** (chỉ cần nhập passphrase của khóa SSH đúng 1 lần):

```powershell
# Chạy tại thư mục gốc C:\Users\Dung\Downloads\AutomationNEWS trên PC:
powershell -ExecutionPolicy Bypass -File .\scripts\update-local-server.ps1
```
*(Thêm cờ `-SyncPremiumEnv` nếu muốn đồng bộ luôn tệp khóa AI `secrets\.env.premium` từ PC sang `/home/congminh/apps/AutomationNEWS/.env.premium` với quyền `600`.)*

### Cách 2: Chuyển gói nén thủ công (2 bước rõ ràng từ PC sang HP)

1. **Trên PC Windows** (tại `C:\Users\Dung\Downloads\AutomationNEWS`), đóng gói mã nguồn sạch (tạo `output/automationnews-home.tar.gz` + `output/SHA256SUMS`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\package-home.ps1
   scp -i "$env:USERPROFILE\.ssh\homeserver_ed25519" .\output\automationnews-home.tar.gz .\output\SHA256SUMS .\scripts\server-update.sh congminh@100.95.33.63:/tmp/
   ```
2. **Trên máy chủ HP** (`ssh -i "$env:USERPROFILE\.ssh\homeserver_ed25519" congminh@100.95.33.63`):
   ```bash
   cd /tmp
   sha256sum -c SHA256SUMS
   sed -i 's/\r$//' server-update.sh
   bash server-update.sh --app-dir /home/congminh/apps/AutomationNEWS --archive /tmp/automationnews-home.tar.gz
   ```

### Những bước an toàn mà `scripts/server-update.sh` tự động thực hiện
1. Kiểm tra nguyên vẹn gói nguồn, giữ nguyên `.env.home`, `.env.premium`, `secrets/` và volume `automationnews_hub_data` (tuyệt đối không chạm vào `BankingPrj` / `banking-local` trên cổng `127.0.0.1:8090`).
2. Build image mới **trước khi** dừng dịch vụ cũ để giảm thời gian ngưng xuống chỉ vài giây.
3. Gắn thẻ rollback cho cả 4 image đang chạy (`api`, `worker`, `scheduler`, `web`) và tạo `data/backups/<timestamp>/compose.rollback.yaml`.
4. Tạm dừng `scheduler` -> `worker` -> `api`, sao lưu `pg_dump` ra `./data/backups/<timestamp>/database.dump` kèm mã băm `SHA256`.
5. Khôi phục thử vào database tạm `hub_restore_*`, đối chiếu khớp số dòng toàn bộ bảng bằng `verify-restore.ts`, chạy thử migration `001`–`019` trên bản tạm rồi **tự động dọn sạch database tạm** (`DROP DATABASE`).
6. Chạy migration chính thức, khởi động lại `api`, `worker`, `scheduler`, `web`, kiểm tra `http://127.0.0.1:8091/api/ready` — nếu bất kỳ bước nào lỗi, **tự động rollback** về phiên bản trước đó.

---

## 7. Cấu hình Reverse Proxy / Cloudflare Tunnel & Biến `.env.home`

- **Mẫu cấu hình sẵn cho `/home/congminh/apps/_proxy/sites/`:**
  - Nginx host proxy: `infra/proxy/automationnews.nginx.conf`
  - Caddy host proxy: `infra/proxy/automationnews.caddy`
  - Cloudflare Tunnel ingress mẫu: `infra/proxy/cloudflared-ingress.example.yml`
- **Các biến môi trường trong `.env.home` trên server** (đối chiếu với `.env.home.example`):
  - Bắt buộc có sẵn (giữ nguyên trên server): `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `WEB_PORT=8091`, `APP_ORIGIN`, `OWNER_EMAIL`.
  - Biến mới bổ sung (tùy chọn, đã có giá trị mặc định an toàn):
    - `COMPOSE_PROJECT_NAME=automationnews` — khóa cứng tên project Compose để không bao giờ tạo nhầm volume mới.
    - `TRUSTED_PROXY_CIDRS=` — để trống sẽ mặc định tin cậy loopback & mạng Docker nội bộ khi `TRUST_PROXY=true`.
    - `NTFY_AUTH_ORIGIN=` — khóa cứng origin duy nhất được nhận `NTFY_TOKEN` (mặc định theo `ACCOUNT_NTFY_URL`).
