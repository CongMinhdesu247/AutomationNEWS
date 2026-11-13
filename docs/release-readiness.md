# Release readiness — Personal Automation Hub v1.0.0

Ngày rà soát: **12/11/2026, Asia/Saigon**. Trạng thái: **bản chuẩn bị phát hành cục bộ để xem xét**. Đủ bằng chứng cho demo portfolio có nhãn fixture và cài đặt localhost; **chưa kết luận đã nghiệm thu vận hành thực tế ba buổi sáng**. Chưa công khai repository, tạo release/tag/commit hoặc push.

## Nguồn sự thật đã đọc

Không tìm thấy AGENTS.md trong repository hoặc các thư mục cha đã kiểm tra. Đã đọc README, architecture, verification bước 1–6, migrations 001–006, manifests/lockfile, connector, service, DAG engine, queue/worker, scheduler/outbox, SSE store/hub, dashboard và Compose/Nginx. Working tree có thay đổi bước 6 và file mới chưa commit; không lấy commit cũ làm đại diện cho bản được nghiệm thu.

## Đã đạt

### Chức năng cốt lõi

| Chức năng | Có trong code và bằng chứng chạy lại | Giới hạn / chưa xác minh live |
| --- | --- | --- |
| RSS | HTTP client có DNS/IP/redirect policy, 24 giờ, bỏ ngày thiếu, dedup GUID/URL/tracking, plain text; unit/integration fixture và browser có tin | Chưa lấy RSS live trong lần v1.0.0 |
| Thời tiết | Open-Meteo đúng ngày theo timezone, null không thành 0, WMO tiếng Việt/ô/attribution; fixture test và bản tin browser | Chưa gọi Open-Meteo live trong lần v1.0.0 |
| GitHub | REST Search/core quota riêng; bỏ fork/archive, snapshot/baseline 20–28 giờ, tăng âm, fallback dự án mới; unit/integration fixture và browser | Chưa kiểm chứng quota/token hoặc baseline live qua ngày |
| Scheduler + ntfy | Daily wall-clock/timezone/DST, unique ngày, missed-run grace, outbox transaction, manual key và không auto resend unknown; integration và browser fixture tick đến hạn + một POST giả | Chưa chờ lịch sáng thật hoặc nhận push trên điện thoại |
| DAG song song | Engine TypeScript thuần, sáu node digest.v1, all_success/all_settled, skipped propagation; tests và worker fixture thật | Không có editor DAG/định nghĩa workflow tùy ý |
| Retry/DLQ | Backoff/jitter, Retry-After, permanent/transient, retry due, replay snapshot sang run mới; PostgreSQL tests và browser | Không benchmark retry storm hoặc tải production |
| Worker recovery | SKIP LOCKED, run lock, lease/heartbeat/fencing; concurrent claim/finish, stale writer và kill worker process thật được test | Demo browser bỏ heartbeat một claim, không giả vờ kill process |
| SSE/reconnect | Transaction event sequence, snapshot/cursor, Last-Event-ID, reset, dedup, heartbeat/buffer/cleanup; PostgreSQL, Nginx thật và browser offline/online/reload | Chưa soak nhiều giờ hoặc nhiều API replica |
| Persistence/vận hành | Settings snapshot, idempotency, migration chạy lại; retention batch/dry-run/floor reset; backup/restore có kiểm chứng bước 6 | Chưa tự backup/retention hoặc PITR; không dọn mọi bảng lịch sử |

RSS live chưa được lấy trong lần rà soát này. Dữ liệu ba nguồn và ntfy trong test tự động đều inject HTTP fixture, không gửi ra dịch vụ thật. Source lỗi không làm mất kết quả nguồn khác; execution completed có thể có digest partial/failed, không phải lỗi engine bị che giấu.

### Cài từ đầu theo README

Đã xuất working tree hiện tại vào `output/release-v1-review/source`, không có personal `.env`, `.git`, `node_modules`, `dist` hoặc output cũ; gồm cả file mới chưa tracked. Tạo `.env` từ `.env.example`, chỉ dùng credential thử riêng. Không clone từ commit cũ vì commit đó chưa chứa thay đổi bước 6.

**Compose chính:** project mới `hub-v1-review`, named volume `hub-v1-review_hub_data`, dashboard `127.0.0.1:8108`. Dùng đúng lệnh cài song song trong README, migration 001–006 tự chạy; API/web/DB đạt health, worker và scheduler chạy riêng. API health/ready qua; cài mới có cấu hình mặc định. Lưu cả năm nhóm với mọi tích hợp tắt, đọc lại đúng; restart API, reload browser vẫn giữ dữ liệu. Migration chạy lại qua, số migration vẫn 6. Scheduler.lastCheckedAt cập nhật, cấu hình scheduler active=false, không gửi thông báo. Browser production không có banner fixture.

**Demo mới:** project `hub-v1-demo`, volume `hub-v1-demo_step6_data`, port 54369/3004/8109 để không chiếm port demo cũ đang dùng. Browser chạy cấu hình → run → DAG → digest, retry, partial, DLQ replay, abandoned lease/recovery, SSE mất mạng/reconnect/reload, scheduled outbox/ntfy fixture và mobile. Proxy smoke xác nhận event/sync terminal=false tới trước EOF qua Nginx, reconnect theo Last-Event-ID và terminal sync.

Các project và volume ứng dụng đang dùng không bị stop/recreate/migrate hoặc xóa để chạy nghiệm thu. Hai project review đã được dừng sau kiểm tra và giữ volume. Không có test thông báo thật hoặc thay lịch cá nhân.

### Kiểm tra đã chạy trong lần v1.0.0

| Kiểm tra | Kết quả |
| --- | --- |
| pnpm install --frozen-lockfile | Qua ở workspace và bản source mới; lockfile không đổi |
| pnpm typecheck | Qua ở workspace và source mới |
| pnpm test | **61/61** unit test, 6 file, qua ở workspace và source mới |
| pnpm build | Qua, production bundle web/API/worker/scheduler được typecheck |
| pnpm test:integration trên PostgreSQL mới | **40/40**, 6 file, qua trong image chạy user node |
| Full Docker Compose từ source mới | Build/install dependency từ lockfile, migration và startup qua |
| Migration lặp + settings qua restart | Qua trên DB mới |
| Playwright browser flow qua Nginx | Qua, desktop 1280×720/mobile 390×844, fixture không gọi Internet |
| Proxy SSE smoke | Qua; không chỉ kiểm kết nối thẳng API |
| API đổi IP, không restart web | REST phục hồi trên cả project review/demo; SSE smoke qua proxy sau đó qua |
| pnpm audit --prod --json | Registry audit trả 0 info/low/moderate/high/critical tại thời điểm kiểm tra |
| Gitleaks 8.30.1 source/history | Không tìm thấy leak trong phạm vi quét, redaction 100% |
| git diff --check | Qua sau hoàn thiện artifact |

Node host v24.21.0, image Node v24.22.3, pnpm 11.25.0, Vitest 5.1.0, PostgreSQL 17.11, Docker Engine 29.9.2, Nginx 1.30.6; Chrome/Chromium qua Playwright CLI 0.1.24. Đây là kiểm tra local, không có CI cloud hoặc máy Windows hoàn toàn mới được provision lại. Cài dependency có thể dùng pnpm store/Docker base cache, nhưng source mới không mang node_modules/build output từ ứng dụng đang dùng.

### Lỗi cài đặt/kiểm chứng đã sửa

- Port 8088 cứng và demo 54359/3003/8099 gây xung đột khi nghiệm thu cạnh stack cũ: thêm WEB_PORT và DEMO_*_PORT, giữ nguyên localhost/default.
- Vitest quét nhầm test trong bản sao output, gây suite lỗi và đếm trùng: thêm vitest.config.ts chỉ include apps/packages; xác nhận lại đúng 61 unit test.
- Config Vitest TypeScript cần Vite temp cache nhưng user node không ghi được trong image: tạo riêng `.vite-temp`/`.vitest-cache` với owner node, không chạy app bằng root hoặc cho ghi rộng toàn source. 40 integration test chạy lại qua, không còn startup EACCES.
- Rebuild/recreate API có thể đổi IP nhưng Nginx giữ địa chỉ cũ và trả 502 lâu dài: dùng Docker resolver 127.0.0.11 với TTL 5 giây và proxy URI/cursor đầy đủ. Test buộc API đổi IP, giữ nguyên container web, kiểm tra REST phục hồi rồi chạy SSE smoke.
- README có đường dẫn workspace cá nhân cố định: thay bằng hướng dẫn mở terminal tại root. Version manifest và User-Agent chuẩn bị ở 1.0.0; không tạo Git tag.

## Kiểm tra khả năng công khai repository

### Phạm vi và kết quả

1. Quét Gitleaks 8.30.1 default rules trên 122 file source dự kiến đưa vào Git, gồm tracked và untracked không bị ignore; `--redact=100`, không in secret vào báo cáo. Không scan cả node_modules/dump vào public source.
2. Quét `gitleaks git --log-opts='--all --full-history'` trên mọi ref local: **1 commit**, HEAD `e0b4b02`; 171 reachable object, 125 blob được đối chiếu bổ sung. Reflog chỉ tham chiếu commit này; fsck không báo unreachable object. Không fetch hoặc suy rằng remote/private fork/cache bên ngoài đã được kiểm tra.
3. Đối chiếu giá trị secret cấu hình cục bộ có thể kiểm tra (không rỗng/không placeholder) với nội dung source và mọi reachable blob: không có exact match. Không ghi giá trị vào log/report. Hai file frontend bundle đã build cũng được đối chiếu với secret cấu hình đã biết, không có match.
4. `.env` không tracked và không có trong commit lịch sử được kiểm tra; `.env.example` chỉ placeholder/biến trống. Dump/log/output/Playwright artifacts được gitignore, `.env`/output/.git/node_modules bị loại khỏi Docker context. Manifest npm vẫn private, không chuẩn bị publish package lên npm.
5. Mở xem cả bốn PNG trong docs/images, không có chunk metadata tEXt/zTXt/iTXt/eXIf nhúng: banner DEMO FIXTURE, nội dung/tên nguồn giả, run UUID thử; không thấy token, topic cá nhân, đường dẫn tài khoản hoặc nội dung push điện thoại. JSON benchmark chứa UUID/timing và cấu hình máy phục vụ tái lập, không phải dữ liệu nguồn cá nhân. Không coi Gitleaks là OCR ảnh hoặc kiểm toán mọi dạng bí mật.
6. Git commit có tên/email author/committer. Không chép giá trị vào báo cáo, không sửa history. Đây là metadata sẽ đi cùng repository; chủ dự án cần tự xem trước khi public. Không thấy email Git đó trong source hiện tại.

**Không phát hiện secret đã lộ trong phạm vi đã quét.** Đây không phải chứng nhận bảo mật toàn diện; scanner có thể bỏ sót giá trị không có pattern/được mã hóa hoặc thông tin cá nhân ngoài phạm vi. Nếu kiểm tra sau phát hiện credential thật: ghi path/commit/line mà không chép giá trị, chủ tài khoản thu hồi/xoay credential trước; xử lý lịch sử/fork/cache là quyết định riêng của chủ repository. Không tự thực hiện các thao tác này.

Raw tool report đã redacted và dữ liệu thử chỉ ở `output/release-v1-review/`, không phải artifact public. Không upload ZIP toàn workspace vì có `.env`, dump và node_modules bị ignore. Chỉ xem xét những file đã được kiểm tra để đưa vào Git; chạy lại audit sau khi thêm file/ảnh/commit mới.

### Lệnh kiểm tra lại

```powershell
New-Item -ItemType Directory -Force output/release-audit | Out-Null
gitleaks git --log-opts='--all --full-history' --redact=100 --no-banner --report-format=json --report-path=output/release-audit/history.json .
pnpm audit --prod --json | Set-Content output/release-audit/dependencies.json
git check-ignore .env output/step6/demo.dump .playwright-cli
git ls-files .env '*.dump' '*.log'
```

Muốn quét working tree, xuất tracked + untracked không ignored sang thư mục source sạch rồi dùng `gitleaks dir --redact=100` trên thư mục đó. Không dùng báo cáo chứa secret chưa redacted làm artifact public. Không dùng `git clean`, rewrite history, rotate token hoặc push như một phần của lệnh kiểm tra.

## Chưa đạt

- **0/3 buổi sáng thực tế** được chủ dự án xác nhận. [Checklist](morning-checklist.md) còn trống, không được suy thành đã vận hành thành công từ các test fixture.
- **Chưa có LICENSE được chọn.** Chưa gán nhãn open-source hoặc tự chọn giấy phép thay chủ repository.
- Video chưa quay/xuất; chỉ có kịch bản 2 phút 50 giây và ảnh fixture. Đây là phần media còn lại cho portfolio.

Không còn lỗi cài mới hoặc kiểm thử cốt lõi đã tái hiện mà chưa sửa trong phạm vi nghiệm thu. Các mục trên còn lại trước khi chốt portfolio public và kết luận nghiệm thu live đầy đủ, không phủ nhận code/demo đã chạy.

## Chưa xác minh

- RSS/Open-Meteo/GitHub qua mạng thật với nguồn/credential của người dùng trong lần chuẩn bị này; GitHub baseline live và quota qua ngày.
- Máy thực sự chạy qua lịch sáng, điện thoại nhận ntfy, mất mạng/sleep dài và vận hành ba ngày.
- Safari/Firefox/điện thoại thật, soak/load lớn, nhiều API replica hoặc mọi dạng client TCP đọc chậm.
- Backup dữ liệu lớn/offsite/PITR và tự động dọn toàn lịch sử. Backup/restore nhỏ đã có bằng chứng bước 6, không chạy lại trên dữ liệu cá nhân trong lần v1.0.0.
- Public hosting/auth/TLS nằm ngoài v1.0.0 localhost; không mở dashboard ra Internet. Không tuyên bố exactly-once job/HTTP/push.

## Những việc cần người dùng thực hiện

- [ ] Xem xét working tree, cả file mới bước 6/v1.0.0; chỉ dùng HEAD hiện tại sẽ thiếu artifact mới. Không tự stage/commit trong lần bàn giao này.
- [ ] Xem metadata tác giả Git, chọn giấy phép và nội dung repository description trong [portfolio.md](portfolio.md).
- [ ] Áp dụng bản đã xem xét vào môi trường sử dụng riêng theo README, backup trước; giữ dữ liệu/volume hiện có.
- [ ] Hoàn thành [ba buổi sáng thực tế](morning-checklist.md), ghi bằng chứng cá nhân vào output, chỉ đưa kết quả đã làm sạch vào tài liệu public.
- [ ] Quay video theo [demo.md](demo.md), giữ banner fixture; không mô tả mock HTTP thành lời gọi API thật hoặc abandoned lease thành kill process.
- [ ] Dùng đúng ba CV bullet trong [portfolio.md](portfolio.md); benchmark chỉ là fixture 12 mẫu/concurrency, không bổ sung số liệu chưa đo.
- [ ] Sau khi chốt nội dung, tự quyết định commit/tag v1.0.0/release/push hoặc public repository; chạy lại audit cho các commit mới trước khi public.

Artifact cục bộ: [README](../README.md), [CHANGELOG](../CHANGELOG.md), [kiến trúc](architecture.md), [vận hành](operations.md), [demo/video](demo.md), [CV và GitHub description](portfolio.md), [checklist ba sáng](morning-checklist.md). Không có feature lớn mới, dịch vụ trả phí hoặc thao tác public nào được thực hiện.
