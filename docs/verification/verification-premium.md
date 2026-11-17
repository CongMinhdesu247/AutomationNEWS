# Kiểm chứng Premium beta — 15/11/2026

Phạm vi: source local Windows PC; PostgreSQL 17 Docker Desktop cô lập. Không truy cập hoặc cập nhật HP, BankingPrj, tunnel, domain, volume production. Không gọi Gemini/Brave thật và không gửi ntfy tới điện thoại.

## Kết quả thực chạy

| Kiểm tra | Kết quả |
| --- | --- |
| `pnpm test` lần cuối | 148/148, 25 files |
| `pnpm typecheck` lần cuối | Cả 6 workspace packages đạt |
| `pnpm build` lần cuối | TypeScript/Vite đạt |
| Toàn bộ `pnpm test:integration` gần nhất | 71/71, 10 files, 9,68 giây |
| `pnpm test:premium` sau sửa admission/idempotency | 27/27: 21 integration và 6 unit; toàn suite integration sau đó cũng đã đạt 71/71 |
| Browser thật, API/auth/worker thật, HTTP/AI/search fake | Tạo → preview → xác nhận bằng Space/Tab/Enter → matching đạt; không tự kích hoạt khi AI đề xuất |
| Browser enrichment/discovery | Fake enrichment đạt; fake search → ứng viên URL → đề nghị duyệt đạt; trang admin hiển thị |
| Browser Free | Gói Free hiển thị, nút tạo nhu cầu bị khóa, không có link admin |
| Mobile 390×844 và desktop 1440×1000 | Đã xem ảnh và sửa chồng nút sticky/nhãn điều hướng; page scrollWidth 375 ≤ viewport 390 |
| Backup/restore PostgreSQL | pg_dump custom + pg_restore vào DB khác, fingerprint 33/33 bảng khớp; có dữ liệu tài khoản/settings/lịch/bản tin và toàn bộ nhóm Premium/cache/usage |
| Migration | DB mới trong các integration cũ; DB mô phỏng 010 có account/settings/lịch/digest/notification rồi lên 011–012; checksum và rerun an toàn, dữ liệu cũ không đổi |
| Đo đọc plan fixture trên PC | 20 request tuần tự, p50 8 ms/p95 22 ms; không đại diện HP hoặc tải đồng thời nhiều tài khoản |
| RAM PostgreSQL fixture tại một thời điểm | 116,1 MiB trên Docker Desktop; không phải đo server HP |

Các bản sửa đã được test trực tiếp: tác vụ Premium không làm tiêu hao giới hạn 10 digest thủ công/ngày; user A không đọc/sửa tài nguyên B; admin Free không có quyền Premium; giới hạn active watch và ngân sách atomic khi chạy đồng thời; API tính quota pending; key lặp trả cùng job, payload khác bị 409; expiry giữ dữ liệu và chặn worker; AI tắt vẫn có digest thường; schema/evidence sai bị loại; usage unknown không bằng 0; recovery không gọi lại provider đã có reservation; enrichment/cache nguồn dùng chung; search units/quota riêng; URL IPv4/IPv6/DNS nội bộ bị chặn; ntfy destination allowlist chặn đích ngoài trước HTTP.

RSS/source và AI/search đều dùng fake/fixtures trong CI. Một số bài safeHttp hiện có dùng HTTP server loopback để kiểm tra timeout/redirect/size. Các bài search mới dùng IP public literal cho ứng viên giả, không fetch ứng viên và không gọi DNS public để tìm kết quả thật. Không có API key provider trong fixtures.

## Chạy lại integration

PowerShell tại `C:\Users\ADMIN\AutomationNEWS`:

```powershell
docker compose -p automationnews-premium-test -f tests/accounts/compose.yaml up -d --wait db
$env:TEST_DATABASE_URL='postgresql://accounts_test:fixture_only@127.0.0.1:54369/accounts_test'
pnpm test:integration
pnpm test:premium
```

Tên project/port dành riêng fixture. Mỗi test tạo schema riêng và dọn đúng schema đó; không đặt TEST_DATABASE_URL thành production. Không chạy `down -v` hoặc prune Docker toàn hệ thống.

## Chạy lại UI với AI/search giả

Hai cửa sổ PowerShell trong repository:

```powershell
# Cửa sổ 1: fixture API và worker, DB mới trong schema ngẫu nhiên.
$env:TEST_DATABASE_URL='postgresql://accounts_test:fixture_only@127.0.0.1:54369/accounts_test'
$env:PREMIUM_BROWSER_FIXTURE='1'
$env:PREMIUM_SEARCH_FIXTURE='1'
pnpm --filter @hub/api exec tsx ../../tests/premium/server.ts
```

```powershell
# Cửa sổ 2: Vite, chỉ proxy tới fixture API.
$env:HUB_DEV_API_URL='http://127.0.0.1:3016'
pnpm --filter @hub/web exec vite --host 127.0.0.1 --port 5186
```

Trong cửa sổ thứ ba:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=premium open http://127.0.0.1:5186 --headed
npx --yes --package @playwright/cli playwright-cli -s=premium run-code --filename tests/premium/browser.cjs
```

Tài khoản fixture: admin@fixture.invalid/member@fixture.invalid, mật khẩu `premium-fixture-password`, chỉ tồn tại trong DB test. Bản server fixture inject fake adapter kể cả khi bật UI AI/search. Dừng API bằng Ctrl+C để đóng worker và dọn schema; không copy fixture thành production entry point.

Ảnh đã tạo trong `output/playwright/`: premium-mobile-results.png, premium-desktop-results.png, premium-admin.png, premium-free-mobile.png. Các lần chạy lại UI tạo thêm nhu cầu trong cùng schema; dùng fixture server mới khi cần ảnh sạch.

## Gói image và smoke test trên PC

Docker Desktop linux/x86_64 đã hoạt động trở lại. Bốn image api/worker/scheduler/web đã build thành công và xuất `output/automationnews-premium-images.tar`. Image API đã chạy lại migration trên DB restore fixture thành công; API/web khởi động healthy, proxy `/api/ready` trả ready và endpoint plan không session trả 401. Worker/scheduler đã kiểm tra import runtime trong container network none, không khởi động tác vụ hoặc thông báo. Compose smoke nằm ở `tests/premium/compose.release-smoke.yaml`, không publish port và chỉ nối network database test. Chưa coi các bước này là rehearsal cập nhật production.

## Chưa xác minh trước khi cập nhật HP

- Chưa chạy pipeline trên GitHub; đã bổ sung workflow và chạy các lệnh tương ứng ở local như bảng trên.
- Restore là dữ liệu mô phỏng có cả bảng cũ/mới, không phải dump production. Chưa rehearsal rollback image/schema trên HP hoặc staging tương đương production.
- Chưa đo CPU/RAM/HDD/IO/load HP, hiện trạng PostgreSQL/Compose thực, tài khoản billing/provider, quyền lưu kết quả search, email verification/reset email, ntfy auth/ACL và điện thoại nhận thật.
- Hạn chót deterministic chỉ nhận nhãn/ngày ISO rõ ràng, region/type dựa từ khóa; chưa có suy luận địa lý/đồng nghĩa đầy đủ. Custom hiện hỗ trợ RSS/Atom đã duyệt; không hỗ trợ tự crawl URL bất kỳ.

AI/search mặc định tắt, ngân sách 0, FREE_ONLY bật. Các kiểm chứng trên không cấp quyền triển khai production. Dùng [runbook phát hành](../guides/premium-release.md) sau khi đã chốt gói và được chủ dự án cho phép.


## Kiểm chứng bổ sung 16/11/2026 — UI và đăng ký beta

- Source mới: 148 unit + 73 integration đạt, typecheck và build đạt; riêng suite Premium 29/29.
- Browser thật với fixture: user Free gửi đăng ký, vẫn Free khi pending; admin duyệt, member có Premium và giữ role member; tạo theo dõi bằng bàn phím, khớp tin, AI không tự xác nhận. Đã kiểm tra 1440/390/320 px không tràn và phân trang căn giữa.
- Ảnh mới: premium-signup-mobile.png, premium-signup-admin.png, premium-simplified-watches-desktop.png, premium-simplified-watches-mobile.png, premium-simplified-editor-desktop.png và premium-simplified-results-{width}.png trong output/playwright/.
- Database localhost đã migrate 013 trong schema fixture đang dùng và giữ nguyên dữ liệu người dùng vừa thử; API preview đã reload. HP chưa thay đổi.
- Báo cáo image/restore 33 bảng ở trên thuộc gói 011–012 đã đóng trước đây. Gói mới có 013 phải đóng lại, kiểm tra image/restore cho bảng request trước phát hành. Không lấy kết quả gói cũ làm bằng chứng image mới đã được kiểm tra.


## Chốt gói premium-beta-20261116-r1 — 16/11/2026

Chạy lại: 148/148 unit, 73/73 integration, typecheck/build đạt. Backup/restore dữ liệu fixture với migrations 001–013: 34/34 bảng fingerprint khớp, có news_plan_requests. Bốn image linux/amd64 đã build lại và có tag premium-beta-20261116-r1; gói mới thay thế artifact 011–012 cũ. Các phần “cần đóng lại” ở nhật ký trên mô tả trạng thái trước lần chốt này. HP chưa được cập nhật; quyền cấp gói vẫn thủ công, AI/search production vẫn mặc định tắt và budget 0. Rollback image thực tế của HP chưa rehearsal; runbook giữ schema và hủy riêng job premium trước dùng worker cũ.

## Chuẩn bị bản HP 20261116-r3 — 16/11/2026

- Toàn bộ typecheck đạt, 149 unit test và 76 integration test đạt.
- Đã build bốn image linux/amd64 mang tag 20261116-r3 từ source hiện tại.
- Image API chạy migrations 001–016 trên database cô lập hub_restore_release_r3_source thành công. API và web healthy, /api/ready trả ready, QR thanh toán có trong image web.
- pg_dump/pg_restore sang database cô lập khác thành công. verify-restore.ts xác nhận fingerprint 34/34 bảng khớp, gồm 16 migration và một tài khoản kiểm tra.
- Bản source có các thay đổi chưa commit. Source và image dùng cùng trạng thái ứng dụng hiện tại, bản mô tả trong manifest.
- Cấu hình Compose của HP đã kiểm tra cú pháp. .env.premium riêng được tạo từ khóa đã cung cấp trên PC, không nằm trong source archive hoặc image frontend.
- HP chưa được cập nhật. SSH bằng homeserver_new đến địa chỉ Tailscale cũ báo Permission denied (publickey), nên tình trạng HP mới nhất cần kiểm tra tại máy.
- Luồng AI và search production dùng hàng đợi thật. Test tích hợp dùng adapter giả. Cần đối chiếu model, giá, hạn mức và thử một truy vấn thật trên HP sau cài đặt.

## Cập nhật HP r3 — 17/11/2026 (giờ Việt Nam)

- Đã triển khai 20261116-r3 trên homeserver, project automationnews. Bốn service api/worker/scheduler/web dùng image r3.
- Backup ngay trước rollout tại /home/congminh/apps/AutomationNEWS/backups/pre_r3_20261116T171320Z.
- Lần chạy kiểm tra phục hồi đầu lỗi do Node tìm tsx từ /app. Đã tự khởi động lại r2, sửa thư mục công cụ thành /app/apps/api rồi chạy lại từ backup mới.
- Phục hồi thử 34/34 bảng fingerprint khớp. Migration đã chạy thành công trên database phục hồi trước khi áp dụng production.
- Production đã có migrations 001–016. Đối chiếu 5 tài khoản, tùy chọn bản tin, 4 bản tin cũ, quyền Premium và cấu hình theo dõi đều khớp backup.
- API/web healthy, worker/scheduler running. /api/ready trả ready cả localhost và URL HTTPS đang dùng. Browser đăng nhập hiển thị đúng, 401 /api/account cho khách chưa đăng nhập là trạng thái dự kiến.
- Khóa provider đã có trong worker và NEWS_FREE_ONLY=false. AI/search vẫn disabled theo cấu hình quản trị hiện hữu, model trống và ngân sách 0. Chưa thực hiện lượt gọi provider thật qua queue production.
- URL hiện tại là https://vsnet-number-president-promoting.trycloudflare.com. BankingPrj vẫn healthy sau cập nhật.
