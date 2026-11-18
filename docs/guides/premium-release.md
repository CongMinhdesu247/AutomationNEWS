# Phát hành AutomationNEWS 20261116-r3 trên HP

> Bản `20261116-r3` gồm migrations 001–016, danh sách nguồn chọn sẵn, đề nghị RSS của thành viên để admin duyệt, lời chào theo gói và đăng ký Premium bằng QR 20.000 ₫. Dùng trọn bộ source, image và `SHA256SUMS` trong cùng thư mục release.

Runbook phát hành và cập nhật. Giữ nguyên các dịch vụ chạy song song, tên miền, tunnel, cấu hình mạng và volume hiện tại.

## Kiểm tra máy chủ trước khi cài

Chạy `scripts/check-home-server.sh` bằng Bash trên máy chủ để đối chiếu thư mục, kiến trúc x86_64, project `automationnews`, volume `automationnews_hub_data`, cổng 8091 và `APP_ORIGIN` thực tế. Script chỉ đọc trạng thái và in việc đã cấu hình khóa API hay chưa.

## 1. Máy phát triển — review, kiểm thử, đóng gói

Tại thư mục gốc của repository:

```powershell
git status --short
git diff --check
pnpm typecheck
pnpm test
docker compose -p automationnews-premium-test -f tests/accounts/compose.yaml up -d --wait db
$env:TEST_DATABASE_URL='postgresql://accounts_test:fixture_only@127.0.0.1:54369/accounts_test'
pnpm test:integration
pnpm build
$release = '20261116-r3'
$releaseDir = "output/$release"
& scripts/package-home.ps1 -OutputDirectory $releaseDir
```

Mong đợi: typecheck/build thành công, unit/integration đạt; tar source có SHA256 và không chứa `.env`, secrets, node_modules hoặc dữ liệu. Review cả file untracked: `git diff` không hiển thị nội dung file mới. Không reset/discard các thay đổi giao diện đã có trước tác vụ. Không commit khi chưa review phạm vi release.

Ưu tiên build image trên PC/CI x86_64 Linux Docker (HP không cần cài Node):

```powershell
$services = 'api', 'worker', 'scheduler', 'web'
$images = foreach ($service in $services) { "automationnews-${service}:${release}" }
foreach ($service in $services) {
    docker build --platform linux/amd64 --target $service -f infra/Dockerfile -t "automationnews-${service}:${release}" .
    if ($LASTEXITCODE -ne 0) { throw "Docker build failed for $service" }
}
docker image save -o "$releaseDir/automationnews-premium-images.tar" $images
if ($LASTEXITCODE -ne 0) { throw 'Docker image export failed' }
$checksums = foreach ($file in 'automationnews-home.tar.gz', 'automationnews-premium-images.tar') {
    $hash = (Get-FileHash "$releaseDir/$file" -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $file"
}
$checksums | Set-Content -Encoding ascii "$releaseDir/SHA256SUMS"
```

Có thể chuyển các tệp đã đóng gói nếu dùng nguyên bản r3. Thư mục release có thêm cấu hình riêng `.env.premium` chứa hai khóa API để dùng trên HP. Chuyển cả tệp này bằng kết nối của chủ server. Chuyển qua SSH/Tailscale sau khi khóa SSH đã được HP chấp nhận:

```powershell
$release = '20261116-r3'
$releaseDir = "output/$release"
$hp = '<ssh-user>@<server-tailscale-ip>'
$key = "$env:USERPROFILE\.ssh\id_ed25519"
ssh -i $key $hp "mkdir -p ~/$release"
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the release directory' }
scp -i $key "$releaseDir/automationnews-home.tar.gz" "$releaseDir/automationnews-premium-images.tar" "$releaseDir/SHA256SUMS" "$releaseDir/.env.premium" "${hp}:~/$release/"
if ($LASTEXITCODE -ne 0) { throw 'Could not copy the release archive' }
ssh -i $key $hp "chmod 700 ~/$release; chmod 600 ~/$release/.env.premium"
```

Đối chiếu hạ tầng thực tế trước khi chạy lệnh chuyển gói.

## 2. Máy chủ Ubuntu — chỉ đọc trước khi cập nhật

Trong `~/apps/AutomationNEWS`, kiểm tra project thật trước khi đặt biến `dc`. Nếu `docker compose ls` hoặc mount không khớp, dừng bước cập nhật và đối chiếu; không sửa tên project để ép khớp.

```bash
release_dir="$HOME/20261116-r3"
(cd "$release_dir" && sha256sum -c SHA256SUMS) || exit 1
cd "$HOME/apps/AutomationNEWS" || exit 1
docker compose ls
dc=(docker compose -p automationnews --env-file .env.home -f infra/compose.yaml -f infra/compose.home.yaml)
"${dc[@]}" config --quiet
"${dc[@]}" ps
docker inspect automationnews-db-1 --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}'
"${dc[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version FROM schema_migrations ORDER BY version"'
free -h
df -h . /var/lib/docker
docker stats --no-stream
curl --fail http://127.0.0.1:8091/api/ready
```

Mong đợi theo tài liệu local: project automationnews, volume automationnews_hub_data, web loopback 8091, API/DB không published; migrations 001–013 theo lần kiểm tra trước, hoặc đến 016 nếu đã cập nhật. Ghi lại image IDs và project trước release; giữ log/resource snapshot nội bộ. Không chia sẻ render `compose config` hoặc inspect env vì có secret. Không chạy Docker prune/down -v.

Domain đã public theo chủ dự án; các đoạn “Pending/Quick Tunnel” trong home-server.md là tài liệu lịch sử, không phải yêu cầu tạo tunnel mới. Giữ origin/domain/tunnel thực tế. Đừng chạy lại bước tạo owner hoặc CLAIM_LEGACY_DATA trong cập nhật này.

## 3. HP — lưu rollback, dừng ghi, backup

Sau khi được phép release, dùng cửa sổ bảo trì ngắn. Nếu đã bật lại app để test local, tạo backup mới ngay trước cập nhật; không dùng dump cũ để giả định dữ liệu mới đã được lưu. Dừng API để chặn đăng ký/chỉnh settings mới; web/tunnel/db vẫn giữ. Scheduler dừng trước worker để không tạo backlog mới. Worker có grace period để hoàn tất việc đang chạy; notification sending bị gián đoạn được xử lý unknown, không tự gửi lại.

```bash
umask 077
release_id=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/$release_id"
chmod 700 backups "backups/$release_id"
for svc in api worker scheduler web; do
  cid=$("${dc[@]}" ps -q "$svc")
  test -n "$cid" || exit 1
  iid=$(docker inspect "$cid" --format '{{.Image}}')
  docker tag "$iid" "automationnews-rollback-$svc:$release_id"
done
tar --exclude=./node_modules --exclude=./output --exclude=./backups --exclude=./.git --exclude=./secrets --exclude=./.env --exclude=./.env.home -czf "backups/$release_id/source.tar.gz" .
"${dc[@]}" stop scheduler
"${dc[@]}" stop worker
"${dc[@]}" stop api
"${dc[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "backups/$release_id/database.dump"
test -s "backups/$release_id/database.dump" || exit 1
"${dc[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --schema-only --no-owner --no-acl' > "backups/$release_id/schema.sql"
sha256sum "backups/$release_id/database.dump"
```

Không tiến hành nếu backup thất bại. Mật khẩu/settings/topic nằm trong dump; giữ quyền 600 và bản sao mã hóa ngoài HP. Không gửi dump vào Git hoặc chat.

## 4. HP — restore thử cô lập, trước migration thật

Restore vào DB mới trên cùng service PostgreSQL, **không** dùng tên database production, không khởi động app/worker/scheduler cho DB restore:

```bash
restore_db="hub_restore_pre_premium_${release_id//-/_}"
"${dc[@]}" exec -T db sh -c 'createdb -U "$POSTGRES_USER" --template=template0 "$1"' sh "$restore_db"
"${dc[@]}" cp "backups/$release_id/database.dump" db:/tmp/automationnews-pre-premium.dump
"${dc[@]}" exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1" --single-transaction --exit-on-error --no-owner --no-acl /tmp/automationnews-pre-premium.dump' sh "$restore_db"
"${dc[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$1" -Atc "SELECT count(*) FROM hub_users; SELECT count(*) FROM user_settings; SELECT count(*) FROM digests; SELECT count(*) FROM schema_migrations"' sh "$restore_db"
```

Đối chiếu số dòng với production qua cùng query. Với database trước 011, chạy fingerprint các bảng đang tồn tại; verify-restore.ts bản mới yêu cầu cả bảng 011–016, nên chỉ dùng sau khi migrate bản restore hoặc sau release 016. Restore có sẵn cấu hình bật thông báo không nguy hiểm khi không chạy tiến trình gửi; không bật app thật chỉ để xem dữ liệu.

## 5. HP — nạp release và chạy migration

Giữ `.env.home`, secrets, Compose project, volume và tunnel. Không chép `.env.example` đè cấu hình. Nạp source vào đúng thư mục đang dùng, không đổi volume/network:

```bash
tar -xzf "$release_dir/automationnews-home.tar.gz" || exit 1
docker image load -i "$release_dir/automationnews-premium-images.tar" || exit 1
install -m 600 "$release_dir/.env.premium" .env.premium || exit 1
dc_release=(docker compose -p automationnews --env-file .env.home --env-file .env.premium -f infra/compose.yaml -f infra/compose.home.yaml -f infra/compose.premium.yaml)
"${dc_release[@]}" config --quiet || exit 1
"${dc_release[@]}" run --rm --no-deps migrate || exit 1
```

Mong đợi: áp dụng các migration chưa có cho đến 016_premium_job_sources.sql; không reset database/role/settings. Migration chạy trong transaction có lock/checksum, lỗi sẽ rollback; nếu báo checksum khác ở 001–010, dừng và tìm sai lệch source, không sửa checksum database.

Tệp riêng .env.premium có NEWS_FREE_ONLY=false, NEWS_AI_KILL_SWITCH=false, NEWS_SEARCH_KILL_SWITCH=false và hai khóa đã cấu hình. Luôn dùng cả hai đối số --env-file theo lệnh dc_release ở trên khi vận hành bản này. Trong Premium & AI, chọn model thật và nhập ngân sách, giá cùng hạn mức phù hợp tài khoản provider trước khi bật AI và tìm kiếm. Image production dùng hàng đợi và worker thật. Dùng mẫu .env.home.example để đối chiếu các tên biến của cấu hình hạ tầng.

```bash
"${dc_release[@]}" up -d --no-build --wait api worker scheduler web
curl --fail http://127.0.0.1:8091/api/ready
"${dc_release[@]}" ps
"${dc_release[@]}" logs --tail=60 api worker scheduler
```

Mong đợi các service healthy/running, không lỗi migration/queue. Không recreate tunnel hoặc db nếu không cần. Image mới được build theo Dockerfile/source đã kiểm tra, không build lại trên HP trừ khi chủ dự án chọn phương án đó.

## 6. Smoke test sau release

- Mở domain public hiện tại bằng thiết bị của chủ dự án. Đăng nhập tài khoản cũ; kiểm tra settings, lịch/timezone, topic và lịch sử vẫn đúng. Free vẫn tạo/xem bản tin như trước.
- Dùng tài khoản thử nghiệm có chủ đích. Admin cấp Premium với ngày hết hạn; xem audit. Admin muốn thử AI vẫn phải được cấp Premium riêng.
- Premium beta không AI: đề nghị RSS công khai có quyền sử dụng, admin kiểm tra feed/điều khoản trước duyệt. Tạo nhu cầu, xem preview rồi xác nhận. Kiểm tra kết quả và section bản tin.
- Tài khoản B không đọc/sửa nhu cầu/kết quả/job của A. Thử revoke/expiry, giữ kết quả và ngừng chạy; gia hạn và lựa chọn kích hoạt lại.
- Chỉ gửi thử ntfy khi chủ tài khoản đã đồng ý nhận một thông báo. Kiểm tra topic/server/allowlist hiện tại trước gửi; không gửi hàng loạt. Không coi healthcheck là bằng chứng điện thoại nhận được.
- Đo RAM/CPU/IO/queue và lịch gửi ít nhất một buổi sáng; đối chiếu tài nguyên các dịch vụ chạy song song mà không can thiệp dự án đó. Không khẳng định capacity/uptime từ kết quả PC.

## 7. Rollback code sau migrations 011–016

Schema 011–016 là bổ sung; giữ schema/dữ liệu khi quay code cũ. Không drop migration 011–016 hoặc xóa dòng schema_migrations. Nhưng worker cũ không hỗ trợ premium.v1: dừng producer/worker trước, kết thúc riêng các task Premium chưa terminal. SQL sau không đụng run digest.v1 hoặc dữ liệu người dùng, cần chạy trong cửa sổ bảo trì đã được phép:

```bash
"${dc_release[@]}" stop scheduler
"${dc_release[@]}" stop worker
"${dc_release[@]}" stop api
"${dc_release[@]}" exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN;
UPDATE news_ai_control SET config=jsonb_set(jsonb_set(config,'{enabled}','false'),'{searchEnabled}','false') WHERE id=1;
UPDATE news_usage SET status='unknown',error_code='RELEASE_ROLLBACK',completed_at=now() WHERE status='dispatched';
UPDATE execution_attempts a SET status='interrupted',completed_at=now()
FROM workflow_jobs j,news_tasks t WHERE a.job_id=j.id AND j.run_id=t.run_id AND a.status='running';
UPDATE workflow_jobs j SET status='failed',worker_id=NULL,claim_token=NULL,lease_until=NULL
FROM news_tasks t WHERE j.run_id=t.run_id AND j.status IN ('queued','leased');
UPDATE node_runs n SET status='failed',completed_at=now(),error='{"code":"RELEASE_ROLLBACK","message":"Tạm dừng tác vụ Premium khi rollback."}'
FROM news_tasks t WHERE n.run_id=t.run_id AND n.status IN ('pending','queued','running');
UPDATE workflow_runs r SET status='failed',completed_at=now(),error='{"code":"RELEASE_ROLLBACK","message":"Tạm dừng tác vụ Premium khi rollback."}'
FROM news_tasks t WHERE r.id=t.run_id AND r.status IN ('queued','running');
COMMIT;
SQL
cat > infra/compose.rollback.local.yaml <<YAML
services:
  api:
    image: automationnews-rollback-api:$release_id
  worker:
    image: automationnews-rollback-worker:$release_id
  scheduler:
    image: automationnews-rollback-scheduler:$release_id
  web:
    image: automationnews-rollback-web:$release_id
YAML
dc_rollback=("${dc[@]}" -f infra/compose.rollback.local.yaml)
"${dc_rollback[@]}" up -d --no-build --no-deps --wait api worker scheduler web
curl --fail http://127.0.0.1:8091/api/ready
```

Không chạy migrate cũ để “undo”. Image cũ dùng schema bổ sung được; rollback này cần nghiệm thu trên staging trước release thật. Source mới có thể để nguyên khi runtime dùng image cũ; khôi phục source.tar.gz vào thư mục staging để review, không giải nén đè mù lên secrets/config. Ghi lại release_id ngoài phiên SSH để tìm tag rollback.

Restore production từ dump chỉ là phương án cuối khi dữ liệu hỏng và đã được chủ dự án cho phép: có thể làm mất mọi thay đổi sau backup. Restore thử vào DB mới, so sánh và lên kế hoạch chuyển kết nối; không tự `pg_restore --clean` vào database đang public.

## 8. Cấu hình AI cho Premium

Trong UI Premium & AI, chọn model hỗ trợ JSON đã thử, nhập giá và pricingVersion theo tài khoản provider hiện tại. Đặt ngân sách dương, concurrency=1 cùng hạn mức dailyCalls và monthlyTokens hữu hạn.

Backend worker: đặt GEMINI_API_KEY bằng cơ chế cấu hình cục bộ hiện tại, NEWS_FREE_ONLY=false, NEWS_AI_KILL_SWITCH=false. API nhận cùng trạng thái FREE_ONLY/kill switch để hiển thị đúng. Recreate riêng worker và API bằng dc_release; không restart database/tunnel hoặc đổi lịch. Không lưu key trong UI/admin API hay Git.

Test một yêu cầu đã được chủ tài khoản đồng ý gửi provider, kiểm tra usage/reservation/chi phí trong billing và output đúng schema. Khi timeout/unknown: không gọi lại tự động, đối soát billing trước. Bật AI không tự bật search; search có công tắc/giá/search units riêng. Công tắc admin tắt AI áp dụng cho call mới; call đã gửi có thể vẫn tính phí. Kill switch môi trường cần recreate API/worker. NEWS_SEARCH_KILL_SWITCH chặn riêng search.

## Lỗi thường gặp

| Triệu chứng | Cách xử lý |
| --- | --- |
| 403 Premium | Kiểm tra starts/expires/status và tài khoản disabled; admin không tự có Premium |
| 429 AI_BUDGET/AI_QUOTA | Kiểm tra UTC cycle và reservations unknown; không sửa ledger thành 0 để chạy tiếp |
| AI_DISABLED dù UI admin bật | Kiểm tra FREE_ONLY/kill switch/backend key; tránh in env vào log |
| Không thấy nguồn | Nguồn đang pending/rejected; admin kiểm tra RSS, không chấp thuận website bất kỳ |
| Nguồn trả HTML | Tìm URL RSS/Atom chính thức; không thêm browser crawler để chữa lỗi |
| Không có kết quả | Điều kiện quá hẹp, không có tin mới 24 giờ, nguồn lỗi hoặc chỉ có dữ liệu ngoài cache |
| Mục không gửi lại | Tin đã được gắn vào bản tin trước; xem website/trạng thái notification, không reset dedupe hàng loạt |
| Login/Origin lỗi | Giữ đúng origin HTTPS đang public; không đổi tunnel/port để chữa khi chưa xác định nguyên nhân |
| Schema/checksum lỗi | Dừng rollout, giữ backup/image cũ, so sánh migrations đã áp dụng |

Không có bước nào ở trên được coi là đã chạy trên HP chỉ vì source local đã hoàn tất.


## 9. Bật khám phá nguồn riêng sau kiểm thử budget/SSRF

Tại Premium & AI, chọn Brave Web Search, kiểm tra hợp đồng/gói cho phép lưu/cache kết quả, ghi nhận searchStorageAllowed, nhập searchPricingVersion và searchUnitMicros theo giá thực tế (không mặc định credit là miễn phí). Đặt dailySearchUnits/monthlySearchUnits hữu hạn, tổng dailyMicros/monthlyMicros đủ cho một request. Premium mặc định tối đa 10 khám phá/tháng UTC; không bị trừ vào 30 lượt hiểu/trích xuất AI. AI có thể tắt trong khi search bật.

Backend worker chỉ đặt BRAVE_SEARCH_API_KEY cục bộ, NEWS_FREE_ONLY=false và NEWS_SEARCH_KILL_SWITCH=false; API nhận cùng công tắc môi trường. Không cần key Gemini cho search. Recreate API/worker trong release đã được phép. Thử một query có chủ đích, kiểm tra một search unit/reservation, URL ứng viên chưa tự approved, user đề nghị nguồn và admin kiểm tra RSS trước duyệt. Thử kill switch, hết quota, lỗi provider và cache trước khi mở rộng.

Kiểm tra quyền lưu/cache kết quả theo gói Brave đang dùng. Localhost đã thử tìm kiếm thật qua Brave và tổng hợp bằng Gemini trong màn xem thử riêng. Luồng hàng đợi production đã được kiểm tra tích hợp bằng adapter giả, cần thử một truy vấn thật trên HP sau khi cấu hình provider và ngân sách.

## 10. Retention định kỳ

Trong thư mục HP hiện tại, chạy dry-run bằng image release trước:

```bash
"${dc_release[@]}" run --rm --no-deps api pnpm --filter @hub/api retention --premium --content-days=30 --result-days=365 --batch=500
```

Sau khi kiểm tra số dòng và chính sách lưu đã thông báo cho user, thêm `--apply` trong cửa sổ bảo trì. Lặp các batch có giới hạn theo quy mô thực tế; tích hợp vào cơ chế bảo trì hiện tại của server nếu cần, không tạo scheduler ứng dụng thứ hai. Kết quả saved, nhu cầu, lịch và bản tin giữ nguyên; unknown usage giữ để đối soát. Không tự chạy retention chỉ vì Premium hết hạn.
