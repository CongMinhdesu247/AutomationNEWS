# Báo cáo Kiểm toán Toàn diện Dự án `AutomationNEWS`

> **Ngày kiểm toán:** 18/11/2026  
> **Phạm vi:** Toàn bộ monorepo (`apps/api`, `apps/web`, `apps/worker`, `apps/scheduler`, `packages/contracts`, `packages/engine`, `db/migrations`, `infra/`, `scripts/`, `docs/`, `pages/`, `output/`) và cấu hình triển khai Local Server theo chuẩn `SERVER_CONTEXT.md`.

---

## Tổng quan Đánh giá

Dự án `AutomationNEWS` có nền tảng kiến trúc tốt (DAG workflow queue bền vững trên PostgreSQL, cơ chế lease/fencing chống chạy trùng, SSRF DNS-pinning trong `connectors/http.ts`, scrypt KDF có giới hạn đồng thời, không dùng `dangerouslySetInnerHTML`). Tuy nhiên, qua rà soát từng tệp mã nguồn và cấu hình hạ tầng, hệ thống hiện tồn tại **32 điểm chưa ổn** chia theo 5 nhóm chính:

1. **Bảo mật & Quyền riêng tư (10 điểm — gồm 4 Critical/High)**
2. **Độ tin cậy Backend, Database & Migration (7 điểm — gồm 3 Critical/High)**
3. **Cấu trúc cây thư mục, Vệ sinh kho mã & Đóng gói (6 điểm — gồm 2 Critical/High)**
4. **Tính năng, Logic Frontend & Trải nghiệm người dùng UI/UX (9 điểm — gồm 2 High)**
5. **Hạ tầng Docker, Reverse Proxy & Đồng bộ Local Server (6 điểm — gồm 3 High)**

Tất cả các mục dưới đây được lưu lại làm hồ sơ đối chiếu và được khắc phục triệt để ngay trong đợt nâng cấp này.

---

## 1. Bảo mật & Quyền riêng tư (Security & Privacy)

### [SEC-01] CRITICAL — Rò rỉ tệp mật khẩu dạng rõ và khóa môi trường trong `output/`
- **Vị trí:**
  - `output/owner-password` (mật khẩu quản trị dạng plaintext còn lưu trên ổ đĩa)
  - `output/account-review.env`, `output/owner-review.yaml`
  - `output/release-v1-review/source/.env` (bản sao đầy đủ `.env` nằm lẫn trong thư mục snapshot code)
- **Rủi ro:** Dù `output/` nằm trong `.gitignore`, các tệp này tồn tại dạng rõ trên máy phát triển và nằm ngay cạnh các bản nén/ảnh chụp màn hình thường được copy qua SCP/chia sẻ.
- **Cách khắc phục:** Xóa triệt để các tệp mật khẩu tạm, `.env` bản sao và thư mục review dư thừa; chuyển hướng dẫn quyền tệp bí mật trên server từ `chmod 644` sang `chmod 600` (do UID `1000` của `congminh` khớp sẵn UID `1000` của user `node` trong container).

### [SEC-02] CRITICAL — Lỗi kế thừa `add_header` của Nginx làm mất `Content-Security-Policy` và Security Headers
- **Vị trí:** `infra/nginx.conf` (dòng 36–38, 68–71, 76–77, 83–84) và `infra/member-nginx.conf` (dòng 39–44).
- **Nguyên nhân:** Trong Nginx, bất kỳ khối `location` nào khai báo `add_header` sẽ **xóa bỏ toàn bộ** `add_header` ở cấp `server`. Do đó, các đường dẫn `/assets/*`, `/sw.js`, `/manifest.webmanifest` và SSE `/api/runs/*/events` bị mất sạch `Content-Security-Policy`, `Permissions-Policy`, `X-Frame-Options` và `Referrer-Policy` (nghiêm trọng nhất là `/sw.js`, tệp SVG trong `/assets/` và `Referrer-Policy: no-referrer` trên cổng thành viên). Đồng thời `/api/` bị gắn trùng lặp header giữa Nginx và Fastify.
- **Cách khắc phục:** Tách cấu hình security headers dùng chung (`infra/security-headers.conf`) và `include` nhất quán trong từng `location` tĩnh; để Fastify quản lý header của `/api/*`.

### [SEC-03] HIGH — Gom chung IP (`$binary_remote_addr`) sau Cloudflare Tunnel / Reverse Proxy gây nghẽn toàn cục & giả mạo `X-Forwarded-For`
- **Vị trí:** `infra/nginx.conf` (dòng 1–2, 25, 44, 50–52), `infra/member-nginx.conf` (dòng 1, 22, 28–30), `apps/api/src/server.ts` (dòng 32–35).
- **Nguyên nhân:**
  1. Container Nginx không cấu hình `real_ip_header` (`CF-Connecting-IP` / `X-Forwarded-For`) cho dải mạng Docker nội bộ, khiến **mọi người dùng truy cập qua Cloudflare Tunnel hoặc Host Proxy đều mang chung 1 địa chỉ IP container**. Hệ quả: `limit_conn hub_sse_conn 10` chặn kết nối SSE thứ 11 trên **toàn hệ thống**, và `limit_req` gom tất cả người dùng vào chung một giỏ giới hạn tốc độ.
  2. `proxy_set_header X-Forwarded-Proto $scheme;` trong container Nginx (chạy cổng HTTP nội bộ) ghi đè `https` của Cloudflare/Proxy thành `http`.
  3. `server.ts` đặt `trustProxy` tin tưởng toàn bộ dải LAN `10.0.0.0/8`, `192.168.0.0/16` ngay cả khi một thiết bị cùng LAN gọi trực tiếp.
- **Cách khắc phục:** Bảo toàn `X-Forwarded-Proto` từ proxy phía trước bằng biến `map`, khôi phục IP thực từ `CF-Connecting-IP` / `X-Forwarded-For` hợp lệ trong mạng nội bộ Docker, và giới hạn `trustProxy` chặt chẽ theo cấu hình môi trường.

### [SEC-04] HIGH — Lỗ hổng giả mạo kho dữ liệu (`?repo=`) và lưu khóa giải mã trên `docs/report.js`
- **Vị trí:** `docs/report.js` (dòng 6–40, 73–85) và bản trùng `pages/report.js`.
- **Nguyên nhân:** Tham số truy vấn `?repo=attacker/repo` cho phép kẻ tấn công tạo liên kết trên tên miền thật của dự án nhưng tải `state.json` từ repository bên ngoài, giải mã nội dung giả mạo và hiển thị liên kết dưới giao diện `BẢN TIN GIA ĐÌNH`. Ngoài ra khóa AES trong `sessionStorage["hub-cloud-report-token"]` không được xóa sau khi giải mã xong.
- **Cách khắc phục:** Khóa cứng nguồn đọc theo đúng chủ sở hữu GitHub Pages hiện tại (chỉ cho phép `?repo=` khi chạy `localhost`/`127.0.0.1` phục vụ kiểm thử), xóa ngay token trong `sessionStorage` sau khi giải mã thành công, và đồng bộ giao diện đọc an toàn.

### [SEC-05] MEDIUM — Container `web` (Nginx) chạy dưới quyền `root` (UID 0) và chung mạng phẳng với Database
- **Vị trí:** `infra/Dockerfile` (dòng 45–51) và `infra/compose.yaml`.
- **Nguyên nhân:** `Dockerfile` đã `chown nginx:nginx` nhưng quên chuyển `USER nginx` và vẫn lắng nghe cổng đặc quyền `80` cùng `/run/nginx.pid`. Toàn bộ `tunnel`, `web`, `api`, `worker`, `scheduler`, `db` nằm chung một mạng Docker mặc định nên container `web`/`tunnel` có thể kết nối thẳng tới `db:5432`.
- **Cách khắc phục:** Cấu hình Nginx chạy non-root (`USER nginx` trên cổng nội bộ `8080`, host map `127.0.0.1:${WEB_PORT:-8091}:8080`), thêm `security_opt: ["no-new-privileges:true"]`, và tách mạng `frontend` / `backend` (`internal: true` cho tầng dữ liệu).

### [SEC-06] MEDIUM — Thiếu giới hạn tốc độ (Rate Limit) trên `/api/member`
- **Vị trí:** `apps/api/src/family/routes.ts` (dòng 275–359) và `apps/api/src/accounts/auth.ts` (dòng 127–138).
- **Nguyên nhân:** Khi truy cập qua cổng chính `8091`, `/api/member` không đi qua `limit_req` của `/api/auth/` và không gọi `throttle()`, cho phép gửi truy vấn dò token liên tục vào PostgreSQL.
- **Cách khắc phục:** Bổ sung `throttle` theo IP trên cả `GET /api/member` và `PUT /api/member`.

### [SEC-07] MEDIUM — Inline `onclick` trong Service Worker `sw.js` xung đột CSP & trả mã `200 OK` khi ngoại tuyến
- **Vị trí:** `apps/web/public/sw.js` (dòng 23, 56–59).
- **Cách khắc phục:** Thay `<button onclick="location.reload()">` bằng liên kết tải lại chuẩn `<a href="">` không dùng inline script, trả mã `503 Service Unavailable` kèm `Cache-Control: no-store` và CSP đầy đủ.

### [SEC-08] LOW-MEDIUM — Liên kết tải mã QR thanh toán chưa qua kiểm tra `safeExternalHref` ở phía client
- **Vị trí:** `apps/web/src/PremiumPortal.tsx` (dòng 1339, 1385–1399).
- **Cách khắc phục:** Chuẩn hóa qua `safeExternalHref`, chỉ nhận `https://` cho ảnh QR từ xa để tương thích CSP `img-src`, và thêm `target="_blank" rel="noopener noreferrer"` khi mở URL ngoài.

### [SEC-09] LOW-MEDIUM — Lộ mã `ntfy` topic bí mật trên thanh địa chỉ trình duyệt và thiếu tính năng đổi mã topic
- **Vị trí:** `apps/web/src/components/PreferencesView.tsx` (dòng 297, 891–895) & `apps/api/src/accounts/routes.ts`.
- **Cách khắc phục:** Bổ sung API `POST /api/account/ntfy-topic/rotate` để người dùng tự tạo lại mã topic ngẫu nhiên mới bất cứ lúc nào nếu nghi ngờ lộ topic; cảnh báo rõ trước khi mở kênh web.

### [SEC-10] LOW — Chưa xóa `hub-member-portal-token` trong `clearAccountSessionStorage()`
- **Vị trí:** `apps/web/src/lib/api-client.ts` (dòng 120–133).
- **Cách khắc phục:** Xóa sạch khóa `hub-member-portal-token` khi kết thúc phiên.

---

## 2. Độ tin cậy Backend, Database & Migration (Backend & DB Reliability)

### [BE-01] CRITICAL — "Bom nổ chậm" Checksum CRLF/LF trong `apps/api/src/migrate.ts`
- **Vị trí:** `apps/api/src/migrate.ts` (dòng 17–25) và `db/migrations/006_retention.sql`.
- **Nguyên nhân:** `migrate.ts` băm SHA-256 trực tiếp chuỗi thô đọc từ đĩa mà không chuẩn hóa `\r\n` -> `\n`. Tệp `006_retention.sql` hiện có lẫn ký tự `CRLF` trong khi máy Windows bật `core.autocrlf=true`. Nếu Git hoặc Docker chuẩn hóa dòng khi đóng gói, `migrate` trên server đang chạy sẽ báo lỗi lệch checksum và dừng toàn bộ hệ thống.
- **Cách khắc phục:** Chuẩn hóa chuỗi SQL về LF (`sql.replace(/\r\n/g, "\n")`) khi tính checksum mới, đồng thời chấp nhận cả checksum LF lẫn CRLF đối với các migration cũ đã từng áp dụng trên DB hiện hữu.

### [BE-02] HIGH — `PGPASSWORD` ghi đè mật khẩu trong `connectionString` tại `apps/api/src/db.ts`
- **Vị trí:** `apps/api/src/db.ts` (dòng 17–20) và `infra/compose.yaml` (dòng 31).
- **Nguyên nhân:** `createPool(connectionString)` luôn gán `password: process.env.PGPASSWORD` nếu biến môi trường này tồn tại, vô tình ghi đè mật khẩu riêng nằm trong `connectionString` (ví dụ khi chạy kiểm thử tích hợp hoặc kiểm tra DB khôi phục `RESTORE_DATABASE_URL`). Ngược lại, `compose.yaml` lại bỏ trống mật khẩu trong `DATABASE_URL`.
- **Cách khắc phục:** Chỉ dùng `process.env.PGPASSWORD` làm fallback khi `connectionString` không tự chứa mật khẩu; đồng bộ cách truyền biến môi trường rõ ràng trong Compose.

### [BE-03] HIGH — Lỗi chuẩn hóa tiếng Việt chữ `đ` / `Đ` khi lọc từ khóa theo dõi (`matchConditions`)
- **Vị trí:** `apps/api/src/premium/store.ts` (dòng 44–54).
- **Nguyên nhân:** `s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()` **không** chuyển `đ`/`Đ` thành `d`. Vì vậy từ khóa `"Da Nang"` hoặc `"hop dong"` không khớp với `"Đà Nẵng"`, `"hợp đồng"` và ngược lại.
- **Cách khắc phục:** Xây dựng hàm chuẩn hóa tiếng Việt dùng chung `foldVi()` trong `@hub/contracts` (`.replace(/[đĐ]/g, "d")`), áp dụng thống nhất cho cả bộ lọc theo dõi phía server lẫn thanh tìm kiếm nhanh phía trình duyệt.

### [BE-04] HIGH — `verify-restore.ts` cố định cứng 34 bảng và nối chuỗi tên bảng trực tiếp trong SQL
- **Vị trí:** `apps/api/src/operations/verify-restore.ts` (dòng 11–43).
- **Nguyên nhân:** Khi nâng cấp từ bản cũ (ít hơn 34 bảng) hoặc khi thêm bảng mới (như `018_bookmarks.sql`), danh sách cứng 34 bảng sẽ làm hỏng bước kiểm tra backup trước khi migrate.
- **Cách khắc phục:** Tự động truy vấn danh sách bảng thực tế từ `pg_tables WHERE schemaname = 'public'` trên DB nguồn, đối chiếu tập bảng giữa hai DB và escape định danh bảng an toàn.

### [BE-05] MEDIUM — Healthcheck giả `kill -0 1` trên `worker` và `scheduler`
- **Vị trí:** `infra/compose.yaml` (dòng 125, 155), `apps/worker/src/main.ts`, `apps/scheduler/src/main.ts`.
- **Nguyên nhân:** `kill -0 1` chỉ kiểm tra tiến trình `tini` (PID 1) còn tồn tại, luôn báo `healthy` ngay cả khi vòng lặp sự kiện bị treo hoặc mất kết nối PostgreSQL liên tục.
- **Cách khắc phục:** Ghi dấu thời gian nhịp đập (heartbeat file `/tmp/hub-worker.ready` và `/tmp/hub-scheduler.ready`) sau mỗi vòng lặp khỏe mạnh và kiểm tra độ tươi của tệp trong Docker healthcheck.

### [BE-06] MEDIUM — Build Backend chỉ chạy `tsc --noEmit` nhưng Production vẫn gánh `tsx` lúc khởi động
- **Vị trí:** `apps/api/package.json`, `infra/Dockerfile` (dòng 20–36), `infra/compose.home.yaml` (dòng 39).
- **Cách khắc phục:** Dọn sạch thư mục thừa `.vite-temp` trong `Dockerfile`, tối ưu lệnh chạy `owner` trực tiếp bằng `node --import tsx` thay vì gọi vòng qua `pnpm --filter @hub/api exec tsx`, và gỡ `EXPOSE 3001` thừa khỏi `worker`/`scheduler`.

### [BE-07] LOW-MEDIUM — Chưa có API riêng cho Đổi giao diện nhanh, Đánh dấu xong việc nhanh & Lưu bài viết (Bookmarks)
- **Vị trí:** `apps/api/src/accounts/routes.ts`.
- **Cách khắc phục:** Bổ sung `PATCH /api/account/theme`, `PATCH /api/account/tasks/:id`, `POST /api/account/ntfy-topic/rotate`, và bộ API `GET/POST/DELETE /api/account/bookmarks` kèm migration `018_bookmarks.sql`.

---

## 3. Cấu trúc Cây thư mục, Vệ sinh Kho mã & Đóng gói (Structure & Hygiene)

### [DIR-01] CRITICAL — `scripts/package-home.ps1` sập do tệp xóa chưa stage và bỏ sót 17+ tệp mới chưa track
- **Vị trí:** `scripts/package-home.ps1` (dòng 11–21).
- **Nguyên nhân:** Dùng `git ls-files --cached` khiến `tar.exe` lỗi ngay lập tức vì `apps/web/src/assets/premium-payment-qr.png` đã xóa trên đĩa nhưng chưa stage, đồng thời bỏ sót toàn bộ các tệp mới (`logger.ts`, `admin-routes.ts`, `017_integrity_and_indexes.sql`, `sw.js`, `components/*`, `lib/*`, `premium/*`).
- **Cách khắc phục:** Cập nhật `package-home.ps1` dùng `git ls-files --cached --others --exclude-standard` kết hợp kiểm tra `Test-Path -LiteralPath $_ -PathType Leaf` và cảnh báo an toàn, đảm bảo gói phát hành luôn đầy đủ 100% mã nguồn hợp lệ mà vẫn loại trừ tuyệt đối `.env`/secrets.

### [DIR-02] HIGH — Thư mục `output/` phình to >715 MB chứa bản sao `node_modules`, ảnh Docker cũ và dữ liệu cạo thô
- **Vị trí:** `output/` (`cloud-verify/`, `release-v1-review/`, 3 tệp `.tar` ~161 MB/tệp, hàng chục tệp `.html`/`.js` cạo thử nghiệm).
- **Cách khắc phục:** Dọn sạch các bản sao repo, kho `.pnpm` thừa, tệp mật khẩu tạm, HTML scrape thô và các gói ảnh `.tar` trùng lặp cũ (bảo toàn tệp khóa `.env.premium` của người dùng vào `secrets/.env.premium` an toàn).

### [DIR-03] MEDIUM — Thư mục `pages/` trùng lặp 100% với `docs/`
- **Vị trí:** `pages/{.nojekyll,index.html,report.html,report.js}` và `docs/{.nojekyll,index.html,report.html,report.js}`.
- **Cách khắc phục:** Xóa thư mục `pages/` dư thừa, giữ `docs/` làm nguồn chuẩn duy nhất cho GitHub Pages như kiến trúc đã quy định.

### [DIR-04] MEDIUM — Các tệp Component khổng lồ (970–1.890 dòng) và cấu trúc phẳng lộn xộn trong `apps/web/src/`
- **Vị trí:** `PremiumPortal.tsx` (1.891 dòng), `DigestDashboard.tsx` (1.564 dòng), `PreferencesView.tsx` (972 dòng), cùng 22 tệp nằm phẳng ở `apps/web/src/`.
- **Cách khắc phục:** Tách thành các module rõ ràng theo miền chức năng trong `apps/web/src/features/{digests,preferences,premium}/`, gom các hàm dùng chung vào `apps/web/src/lib/`, giữ nguyên các điểm xuất (re-export) để tương thích ngược với toàn bộ bài kiểm thử.

### [DIR-05] LOW-MEDIUM — Thiếu loại trừ `/data/`, `*.tar`, `*.tar.gz`, `.github` trong `.dockerignore` & `.gitignore`
- **Vị trí:** `.dockerignore`, `.gitignore`, `.gitattributes`.
- **Cách khắc phục:** Bổ sung đầy đủ `/data/`, `releases/`, `*.tar`, `*.tar.gz` vào `.gitignore` và `.dockerignore` để tuân thủ bố cục `./data/` của `SERVER_CONTEXT.md` mà không làm kẹt Docker build context; chuẩn hóa `.gitattributes` về LF cho `*.sh` và `*.sql`.

### [DIR-06] LOW — Lặp lại 4 lần hàm định dạng ngày giờ `when()` và nhãn node workflow ở Frontend
- **Vị trí:** `AutomationDashboard.tsx`, `FamilyTools.tsx`, `RunDashboard.tsx`, `premium/types.ts`.
- **Cách khắc phục:** Hợp nhất vào module tiện ích chung `apps/web/src/lib/format.ts`.

---

## 4. Tính năng, Logic Frontend & Trải nghiệm Người dùng (Features & UX/UI)

### [UX-01] HIGH — Nút đổi Giao diện Sáng/Tối trên thanh Header gây lỗi `409 REVISION_CONFLICT` và ghi đè Tùy chọn chưa lưu
- **Vị trí:** `apps/web/src/AccountApp.tsx` (dòng 234–257) và `apps/web/src/components/PreferencesView.tsx` (dòng 79, 272–286).
- **Cách khắc phục:** Chuyển nút đổi nhanh Sáng/Tối sang gọi `PATCH /api/account/theme` độc lập, đồng bộ mượt mà trạng thái `theme` xuống `PreferencesView` và cập nhật màu nền `<html>`/`<body>` để loại bỏ hiện tượng viền trắng khi cuộn quá đà ở chế độ tối.

### [UX-02] HIGH — Vòng lặp kết nối lại SSE vô tận mỗi 2 giây khi hết phiên (`401`) hoặc sai ID (`404`) & ẩn tiến độ đối với thành viên
- **Vị trí:** `apps/web/src/RunDashboard.tsx` (dòng 38–52, 163–220, 320–370).
- **Cách khắc phục:**
  1. Khi `EventSource` đóng kết nối, kiểm tra trạng thái qua `apiRequest` với backoff tăng dần và giới hạn số lần thử để tự động bắt lỗi `401`/`404` thay vì lặp vô tận.
  2. Thêm `"premium_task"` vào danh sách thứ tự sắp xếp node.
  3. Hiển thị thanh tiến độ trực quan và danh sách bước thân thiện bằng tiếng Việt cho **mọi người dùng** khi đang tạo bản tin (chỉ ẩn thông tin chẩn đoán kỹ thuật sâu đối với thành viên thường).

### [UX-03] MEDIUM — Rò rỉ bộ đếm `setTimeout` 30–60 giây sau mỗi lệnh gọi API thành công
- **Vị trí:** `apps/web/src/request-signal.ts` và `apps/web/src/lib/api-client.ts`.
- **Cách khắc phục:** Trả kèm hàm `cleanup()` từ `createRequestSignal()` và gọi trong khối `finally` ngay khi `fetch` hoàn tất; bổ sung `AbortSignal` và cờ chống gọi chồng lấn cho các bộ polling.

### [UX-04] MEDIUM — Lỗi đồng bộ Cloud hiển thị dưới nền màu xanh thành công tại `MemberPortal` & lỗi kẹt nút lọc `"Đã lưu"` tại `PremiumPortal`
- **Vị trí:** `apps/web/src/MemberPortal.tsx` (dòng 115, 136–140), `apps/web/src/PremiumPortal.tsx` (dòng 420–422, 1120–1128), `DigestDashboard.tsx` (dòng 716–724 chưa lọc `isDisplayArticle` trong `#section-rss`).
- **Cách khắc phục:** Tách riêng trạng thái cảnh báo lỗi đồng bộ ở `MemberPortal`, giữ nút tắt chế độ `"Đã lưu"` hiển thị ngay cả khi người dùng vừa bỏ lưu mục cuối cùng, và lọc nhất quán dữ liệu mẫu `isDisplayArticle` ở mọi danh sách RSS.

### [UX-05] MEDIUM — Trang chào mừng (`AuthPortal.tsx`) chưa có bản tin mẫu thực tế sống động & thông báo khi đóng đăng ký
- **Cách khắc phục:** Nâng cấp `AuthPortal` với thẻ **Bản tin mẫu 07:00 sáng** giàu dữ liệu thực tế (nhiệt độ, chỉ số AQI, bảng giá vàng SJC + huy hiệu Đáy 30 ngày, điểm tin sáng, dự án GitHub dịch tiếng Việt), nút **"Đọc thử trọn bản tin mẫu"** mở hộp thoại xem trước đầy đủ, tự nhận diện giao diện Sáng/Tối theo thiết bị và hiển thị hướng dẫn lịch sự khi máy chủ đang ở chế độ mời riêng (`!registrationOpen`).

### [UX-06] MEDIUM — Bố cục đọc bản tin (`DigestDashboard`) bị nhảy trang (CLS), thứ tự mục chưa hợp lý & thiếu công cụ đọc hiện đại
- **Cách khắc phục:**
  - Hiển thị **Skeleton Loading** êm dịu trong lúc tải.
  - Đưa khu vực **"Bức tranh sáng nay" (Bento Grid)** lên đầu bản tin: gom **Bầu trời & Môi trường** (Thời tiết kèm biểu tượng, khả năng mưa, thang màu AQI & UV) cạnh **Nhịp đập Thị trường** (Vàng SJC, USD/VND, Xăng RON 95 kèm chênh lệch và thanh vị trí giá 30 ngày).
  - Bổ sung **Đánh dấu hoàn thành việc cần làm ngay trên trang chủ**, **Lưu bài viết (Bookmark)** đồng bộ máy chủ, **Thẻ lọc nhanh theo nguồn báo**, chuyển đổi chế độ **Đọc thoáng / Đọc gọn**, điều hướng **Bản tin trước / tiếp theo**, và phím tắt `/` để tìm nhanh.

### [UX-07] MEDIUM — Trang `PreferencesView` mất cân đối cột & Thanh điều hướng di động của Admin quá tải (7 mục cuộn ngang)
- **Cách khắc phục:**
  - Chia `PreferencesView` thành các phân mục/tab gọn gàng (`Lịch & Giao diện`, `Tin tức & RSS`, `Thời tiết & Thị trường`, `Việc làm & Kỷ niệm`, `GitHub & Thông báo`), thêm trình hướng dẫn khởi tạo nhanh 3 bước cho tài khoản mới.
  - Tối ưu thanh điều hướng dưới cùng trên điện thoại còn tối đa 5 mục gọn đẹp (gom các công cụ quản trị vào ngăn menu **Quản trị** tiện lợi trên màn hình nhỏ) kèm thông báo Toast nổi nhẹ nhàng.

---

## 5. Hạ tầng Docker, Reverse Proxy & Cấu hình Local Server (`SERVER_CONTEXT.md`)

### [OPS-01] HIGH — Bẫy lệch tên Compose Project (`personal-automation-hub` vs `automationnews`)
- **Vị trí:** `infra/compose.yaml` (dòng 1).
- **Rủi ro:** Chạy `docker compose up -d` trên server mà quên cờ `-p automationnews` sẽ tạo ra một stack thứ hai mang tên `personal-automation-hub` gắn vào volume trống mới!
- **Cách khắc phục:** Đổi sang `name: ${COMPOSE_PROJECT_NAME:-automationnews}` và đặt mặc định `COMPOSE_PROJECT_NAME=automationnews` trong `.env.home.example` cũng như `docker-compose.server.yml`.

### [OPS-02] HIGH — Kẹt tag cứng `:20261116-r3` trong `compose.premium.yaml` & đọng Database tạm `hub_restore_*` trên Server
- **Vị trí:** `infra/compose.premium.yaml`, `output/20261116-r3/deploy-r3.sh`.
- **Cách khắc phục:** Tham số hóa `${AUTOMATIONNEWS_IMAGE_TAG:-latest}` trong `compose.premium.yaml`; bổ sung `trap` tự động `DROP DATABASE` tạm sau khi kiểm chứng khôi phục và luôn nạp kèm `.env.premium` (nếu có) cả khi chạy chính lẫn khi rollback.

### [OPS-03] HIGH — Chuẩn hóa đầy đủ theo `SERVER_CONTEXT.md` cho Local Server hiện hữu (Zero-Data-Loss Incremental Update)
- **Hiện trạng & Giải pháp:**
  1. Tạo hồ sơ `SERVER_CONTEXT.md` ngay tại thư mục gốc dự án ghi nhận rõ cấu trúc máy chủ cục bộ, bảng phân bổ cổng (`127.0.0.1:8091` cho `AutomationNEWS`, tách biệt hoàn toàn với `8090` của app song song), quy tắc bảo toàn volume `automationnews_hub_data` và thư mục bền vững `./data/`.
  2. Cung cấp trọn bộ cấu hình mẫu cho `_proxy/sites/` trong `infra/proxy/` (Nginx Reverse Proxy, Caddyfile, Cloudflare Tunnel) hỗ trợ đầy đủ SSE streaming không đệm, `X-Forwarded-Proto` và IP thực.
  3. Xây dựng bộ công cụ cập nhật tự động 1 lệnh từ PC Windows lên Local Server đã có sẵn dự án (`scripts/update-local-server.ps1` + `scripts/server-update.sh`): tự nhận diện bố cục thư mục hiện tại (`~/apps/AutomationNEWS` hoặc `~/apps/AutomationNEWS/source`), giữ nguyên 100% `.env*`, `secrets/` và dữ liệu người dùng, tự sao lưu PostgreSQL ra `./data/backups/`, kiểm thử migration cô lập, cập nhật container với `restart: unless-stopped` và tự động rollback nếu healthcheck không đạt.

---

## 6. Bổ sung Kiểm toán Sâu Tầng Backend, Connectors & AI Pipeline

### [SEC-11] CRITICAL — Vượt tường lửa SSRF qua địa chỉ IPv6 tương thích IPv4 (`[::127.0.0.1]` -> `::7f00:1`) & Cổng TCP tùy ý
- **Vị trí:** `apps/api/src/connectors/http.ts` (dòng 45–54, 69–86) và `apps/api/src/connectors/ntfy.ts` (dòng 27–31).
- **Nguyên nhân:** `new URL("http://[::127.0.0.1]/")` chuẩn hóa thành `[::7f00:1]`. Trong thư viện `ipaddr.js`, `ipaddr.process("::7f00:1").range()` trả về `"unicast"`, làm `isPublicAddress()` trả về `true`! Ngoài ra `checkUrl()` chưa giới hạn cổng `80`/`443` với nguồn ngoài danh sách tin cậy, cho phép dò quét cổng TCP qua URL RSS.
- **Cách khắc phục:** Với IPv6 công khai, bắt buộc thuộc dải Global Unicast IANA `2000::/3`; giới hạn cổng HTTP/HTTPS mặc định (`""`, `"80"`, `"443"`) cho các đích ngoài `allowedOrigins`.

### [SEC-12] HIGH — Nguy cơ lộ `NTFY_TOKEN` sang máy chủ `ntfy.sh` công cộng & nhầm đường dẫn Topic
- **Vị trí:** `apps/api/src/connectors/ntfy.ts` (dòng 90–103), `apps/api/src/server.ts` (dòng 26–30).
- **Nguyên nhân:** `sendNtfy()` đính kèm `Authorization: Bearer <NTFY_TOKEN>` tới mọi origin trong `destinationOrigins` (bao gồm cả `https://ntfy.sh` mặc định).
- **Cách khắc phục:** Chỉ đính kèm `NTFY_TOKEN` khi origin đích không phải `https://ntfy.sh` công cộng (hoặc khớp đúng `NTFY_AUTH_ORIGIN` được chỉ định), và chuẩn hóa gốc đường dẫn publish JSON của ntfy.

### [SEC-13] HIGH — Lộ thông tin lỗi nội bộ/`workerId` ở `GET /api/runs/:id` & Đặt lại sổ cái ngân sách AI khi xóa User (`ON DELETE CASCADE`)
- **Vị trí:** `apps/api/src/workflows/queue.ts` (dòng 544–701), `db/migrations/017_integrity_and_indexes.sql` (dòng 138–143), `apps/api/src/logger.ts`, `apps/api/src/operations/portfolio-server.ts`.
- **Cách khắc phục:**
  - Lọc lỗi qua `telemetryError()` và ẩn `workerId`/`leaseUntil` đối với tài khoản `member` trên `readSnapshot()` và `queue.list()`; kiểm tra `NOT u.disabled` khi replay dead-letter.
  - Đổi khóa ngoại `news_usage(run_id, user_id)` trong `017_integrity_and_indexes.sql` sang `ON DELETE SET NULL` để việc xóa tài khoản/lịch sử không bao giờ xóa sổ cái chi phí AI trong tháng.
  - Bổ sung lọc đệ quy và nhận diện `github_pat_*` trong `logger.ts`; khóa `portfolio-server.ts` chỉ bind `127.0.0.1` và không dùng token thật.
  - Thêm chuẩn hóa tiền tố IPv6 `/64` trong `ipKey()` và giới hạn dò mật khẩu theo email độc lập với IP (`login-target:`).

### [BE-08] HIGH — Ghi đè mã lỗi chi tiết của tác vụ Premium AI/Search thành `"WORKFLOW_FAILED"` chung chung
- **Vị trí:** `apps/api/src/workflows/queue.ts` (dòng 254–269).
- **Cách khắc phục:** Giữ nguyên mã lỗi gốc từ `states.premium_task.error` (`AI_QUOTA`, `AI_BUDGET`, `AI_DISABLED`, v.v.) trên `workflow_runs.error` đối với `premium.v1`.

### [BE-09] HIGH — Lỗi tương thích `thinkingConfig` trên Gemini & Lỗi kết quả rỗng trên Brave Search làm trừ oan hạn mức
- **Vị trí:** `apps/api/src/premium/ai.ts` (dòng 114–117, 385–395) và `apps/api/src/premium/search.ts` (dòng 90–130, 205–215).
- **Cách khắc phục:** Cấu hình `thinkingConfig` đúng theo dòng model (`gemini-2.5-flash` vs `gemini-3`), hoàn trả lượt dự trữ khi nhà cung cấp từ chối rõ ràng bằng mã HTTP `4xx` chưa phát sinh phí, và xử lý êm trường hợp Brave trả `200 OK` với 0 kết quả (`candidates: []`).

### [BE-10] MEDIUM — Ghi đè `timeoutMs` trong `this.http`, khóa cache `news_sources` 15 phút khi tắt Worker, lỗi ngày dương lịch `02-31` & rớt bản tin qua nửa đêm
- **Vị trí:** `workflows/runtime.ts`, `digests/service.ts`, `connectors/{markets,fuel,rss,air-quality,daily-utilities}.ts`, `premium/{sources,runtime}.ts`, `workflows/schedule.ts`.
- **Cách khắc phục:**
  - Đặt `{ timeoutMs: defaultTimeout, ...opts }` để tôn trọng timeout riêng của từng connector; dùng `AbortSignal.timeout` độc lập cho Promise dùng chung kèm dọn bộ nhớ đệm quá hạn.
  - Không đánh dấu lỗi 15 phút trên `news_sources` khi `signal.aborted`; bọc `try/catch` từng nguồn trong `executeCustom` và nâng `tickCustom` lên xử lý theo lô (`LIMIT 20`).
  - Lọc và cắt `maxItems` theo thời gian trước khi gọi `html-to-text` trong `fetchRss` để tránh nghẽn Event Loop.
  - Kiểm tra ngày-tháng hợp lệ thực tế trong `settingsSchema` & `collectHolidays`; thay kiểm tra khác ngày bằng độ trễ tối đa 6 giờ cho bản tin gửi sát nửa đêm; đồng bộ tọa độ & múi giờ cho `airQuality`.

---

## 7. Tổng kết Nghiệm thu & Kết quả Kiểm chứng

Toàn bộ các hạng mục kiểm toán từ Phần 1 đến Phần 6 đã được sửa triệt để trực tiếp trong `AutomationNEWS` kèm theo các nâng cấp trải nghiệm người dùng và hạ tầng Local Server:

- **Kiểm tra kiểu tĩnh (TypeScript):** Đạt `0` lỗi trên cả 6 workspace (`@hub/contracts`, `@hub/engine`, `@hub/api`, `@hub/worker`, `@hub/scheduler`, `@hub/web`).
- **Kiểm thử tự động (Vitest):** `26/26` bộ unit test (`133/133` bài kiểm thử) vượt qua 100%, bao gồm kiểm thử hồi quy mới cho SSRF IPv6/Port, chuẩn hóa tiếng Việt `foldVi`, kiểm tra lịch dương `isValidMonthDay`, ẩn dữ liệu nhạy cảm đệ quy trong log, và các endpoint mới (`/api/public/preview`, `/api/account/theme`, `/api/account/bookmarks`).
- **Đóng gói giao diện Production (Vite 8):** Build thành công trong ~370ms, tách gói lazy-load gọn nhẹ (`index`, `api-client`, `PremiumPortal`, `App`, `MemberPortal`, `AlertPreferences`) kèm nén `gzip` ở tầng Nginx.
- **Sẵn sàng cập nhật Local Server:** Đã tạo đầy đủ `SERVER_CONTEXT.md`, `docker-compose.server.yml`, mẫu proxy `infra/proxy/*`, script đóng gói sạch `scripts/package-home.ps1` (`output/automationnews-home.tar.gz` + `output/SHA256SUMS` chỉ ~868 KB, sạch tuyệt đối khỏi `.env`/`secrets`/`node_modules`) và bộ script cập nhật không mất dữ liệu `scripts/server-update.sh` & `scripts/update-local-server.ps1`.

---

## 8. Vòng Kiểm định Chuyên sâu Lần 2 — AI Pipeline, Dữ liệu Biên & Chuẩn hóa UI/UX

1. **Dọn dẹp cấu trúc & ổn định biên:**
   - Xóa thư mục rác `.playwright-cli/` (hơn 100 tệp log/snapshot cũ), nâng cấp `ErrorBoundary.tsx` (ẩn stack trace ở production, tách `.error-boundary-actions` độc lập khỏi thanh lưu sticky), sửa xử lý `NaN` ở `frequency()` và kiểm tra hợp lệ `datetime-local` trước khi `.toISOString()` trong `PremiumAdmin.tsx`.
   - Khớp toàn bộ khóa hành động kiểm toán (`entitlement.change`, `plan.change`, `ai.control`, `source.review`, `watch.create`, `watch.update`) trong `apps/web/src/premium/types.ts`; thay `console.warn` thô trong `local-preview.ts` bằng `logEvent()` có lọc thông tin nhạy cảm; bổ sung tương thích checksum lịch sử cho `006_retention.sql` trong `migrate.ts` và `ENV CI=true` trong `infra/Dockerfile`.
2. **Gia cố luồng gọi API AI & Search (`apps/api/src/premium/ai.ts`, `search.ts`, `routes.ts`, `PremiumPortal.tsx`):**
   - **Chống lỗi mạng tạm thời (`withTransientProviderRetry`):** Tự động retry 1 lần có jitter & tôn trọng `Retry-After` (bọc `AbortSignal`) đối với lỗi `HTTP_429`/`502`/`503`/`504` ở cả `geminiAdapter` và `braveSearch` mà không gây trừ trùng hạn mức.
   - **Chuẩn hóa & cứu dữ liệu AI (`extractAndRepairAiJson`):** Bóc tách khối JSON khi model bọc ````json ... ````, lọc phần tử rỗng/quá dài, chuẩn hóa ngày `"N/A"`/`"null"` về `null`, bắt riêng `finishReason = SAFETY/BLOCKLIST` (không trừ quota) và cứu chuỗi tóm tắt tiếng Việt bị cắt giữa chừng khi chạm `MAX_TOKENS` — trong khi vẫn giữ nguyên kiểm tra `.strict()` và đối chiếu trích dẫn chống bịa đặt (`evidence`).
   - **Trải nghiệm chờ AI & Hủy yêu cầu (`POST /api/account/custom-jobs/:id/cancel`):** Gắn `AbortController`, khóa chống chồng chéo `inFlight`, giới hạn số vòng hỏi trạng thái, thanh tiến trình mượt `.ai-progress-card`, nút **Dừng chờ** (hủy ngay tác vụ đang xếp hàng không tốn lượt AI) và nút **Thử lại** kèm thông báo tiếng Việt thân thiện `friendlyAiError()` trên cả 4 luồng (`interpret`, `WebBrief`, `TopicBriefRequest`, `Enrichment`).
3. **Tẩy sạch "AI Slop" & Chuẩn hóa vùng chạm >= 44x44px (`index.css`, `account.css`, `premium.css`):**
   - Loại bỏ toàn bộ biểu tượng cảm xúc trang trí (`🎉`, `🌤️`, `💰`) khỏi giao diện, thay bằng hệ thống SVG `<Icon />` đồng bộ.
   - Đồng bộ Design System Tokens (`--accent-soft`, `--border`, `--radius-*`, `--ease-out`) cho cả Light & Dark Mode (sửa lỗi viền sáng trên `<textarea>` và `.custom-preview` ở chế độ tối), đồng thời nâng toàn bộ nút bấm, chip lọc, thẻ điều hướng và nút thao tác nhanh lên chuẩn vùng chạm **>= 44x44px**.
