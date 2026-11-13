# Kiểm chứng bước 6 và portfolio

Ngày bàn giao: **12/11/2026, Asia/Saigon**. Kết quả dưới đây là các lệnh/thao tác đã thực sự chạy, không kế thừa kết luận bước 5 chỉ từ tài liệu.

## Đối chiếu bước 1–5

Không tìm thấy AGENTS.md trong repository hoặc các thư mục cha được kiểm tra. Đã đọc README, architecture, verification bước 1–5, migration 001–005 và code contracts/engine/connector/API/worker/scheduler/SSE/frontend/proxy. Không dựng lại dự án, không sửa migration cũ. Không phát hiện phần thiếu trong code chặn luồng chính; stack cá nhân đang chạy vẫn là image cũ, chưa được nâng cấp bằng code mới.

| Bước | Bằng chứng đã chạy lại |
| --- | --- |
| 1: cấu hình | Integration lưu/đọc đủ năm nhóm, input sai không đổi dữ liệu, rollback, migrate lại; browser sửa địa điểm/lưu/reload giữ nguyên |
| 2: bản tin | Connector fixture qua parse/validation thực, partial giữ RSS/GitHub khi weather lỗi; browser tạo và mở/reload bản tin có cả ba mục |
| 3: DAG/queue | Engine policy/topo/skipped; PostgreSQL locking thật, concurrent claims/finish, lease fencing, idempotency, persist không trùng; test kill worker process thật rồi nhận tiếp |
| 4: retry/lịch/DLQ | Retry due/backoff/Retry-After, permanent/exhausted DLQ và replay mới; timezone/DST và nhiều scheduler; outbox thành công/lỗi/unknown không tự gửi trùng |
| 5: SSE | Transaction rollback/event sequence, race, snapshot-cursor, Last-Event-ID replay/reset, heartbeat/cleanup/buffer; Nginx thực phát trước terminal; browser offline/online, dedup và reload |

Lịch 07:00 Asia/Ho_Chi_Minh được validate/tính mốc bằng unit/integration; E2E chuyển next_run_at đến hạn **trong database fixture** rồi dùng DigestScheduler.tick → worker → persist/outbox → DigestScheduler.deliver. HTTP ntfy inject trả kết quả, ghi nhận 1 POST và lần deliver tiếp theo không thêm POST. Không thay lịch cá nhân hoặc gửi thông báo thật. Lần chạy lại browser trong cùng ngày dùng scheduled run đã có, không tạo lịch/run/delivery trùng. Chưa chờ qua đêm tới 07:00 thật.

## Môi trường riêng và an toàn dữ liệu

Docker project hub-step6-demo có DB step6/volume riêng, PostgreSQL localhost:54359, API fixture localhost:3003, Nginx localhost:8099. Integration và benchmark tạo schema UUID của chính mình trong DB thử; chỉ dọn schema đó. Migrate 001–006 chỉ chạy trên DB thử. Không xóa/reset volume hiện có hoặc database cá nhân. `.env` không bị sửa; stack cá nhân không bị stop/recreate/migrate bởi lệnh nghiệm thu. Docker ban đầu chưa chạy nên đã được khởi động; các container cũ tự chạy lại theo restart policy.

Mọi HTTP connector trong test/demo/benchmark đều inject fixture. Không gửi ntfy thật hoặc dùng API công khai trong nghiệm thu. Banner DEMO FIXTURE và nhãn RSS/địa điểm/repository hiện trên ảnh. Không có route điều khiển demo trong buildApp production; entry point demo có guard môi trường/database.

## Kết quả lệnh

| Lệnh / kiểm tra | Kết quả |
| --- | --- |
| pnpm install --frozen-lockfile | Qua, lockfile không đổi |
| pnpm typecheck | Qua contracts, engine, API, web, worker, scheduler |
| pnpm test | **61/61** test qua |
| pnpm build | Qua, production bundle web |
| pnpm test:integration trong API image, TEST_DATABASE_URL trỏ DB thử | **40/40** test qua, 6 file, không skip |
| docker compose -f tests/portfolio/compose.yaml up -d --build --wait | API/web build và DB/API/web healthy |
| Compose chính config --quiet | Qua; chưa áp dụng vào stack chính |
| node tests/portfolio/proxy-smoke.mjs | Nginx nhận event + sync trước EOF; reconnect header ưu tiên query; terminal sync |
| Playwright CLI run-code tests/portfolio/browser.cjs | Qua toàn bộ luồng, lần đầu có scheduled run/POST fixture mới, lần sau không gửi lại cùng ngày |
| pnpm retention trong container demo (không --apply) | dry-run, 0 event/attempt đủ tuổi; không xóa |
| PowerShell 7.6.9 backup.ps1/restore.ps1 | Dump/copy/restore DB mới thành công; count/hash khớp 13 bảng |
| Windows PowerShell 5.1 backup.ps1/restore.ps1 | Dump/copy/restore DB hub_restore_step6_ps51 thành công |
| Restore lặp vào DB có sẵn | Bị từ chối bởi createdb, không ghi đè |

Vitest trong container user node báo không ghi được disk module cache (EACCES), tiếp tục không cache và toàn bộ test vẫn chạy. Đây không phải test skip.

## Kiểm tra mới của retention

4 integration test PostgreSQL thật xác minh: mặc định dry-run không thay dữ liệu; batch đúng số dòng; không dọn run active hoặc run còn mới; counter attempt không giảm khi xóa log; bản tin/state vẫn còn; cursor cũ nhận CURSOR_EXPIRED và snapshot cursor mới vẫn terminal sync khi đã xóa hết event; rollback khi trigger fixture gây lỗi giữa xóa event/cập nhật floor; nhiều cleaner không xóa trùng/vượt batch; tham số không hợp lệ bị từ chối.

Test concurrency lần đầu phát hiện `ORDER BY sequence` bị alias `sequence::text` dẫn tới sort chuỗi và prefix-delete vượt batch. Đã sửa `ORDER BY run_events.sequence` theo bigint, thêm assertion chênh lệch số dòng thực; toàn bộ 40 integration test chạy lại qua trên image cuối. Floor không reset high-water sequence; việc dọn không phát trạng thái workflow giả.

## Browser và ảnh

Chromium 157 headless qua Playwright CLI 0.1.24, Nginx 1.30.6 thật. Desktop viewport 1280×720 và mobile 390×844. Đã kiểm tra cấu hình → run → DAG → digest, bản tin reload, source partial, retry, DLQ button replay, abandoned claim/recovery, offline/reconnect/reload và schedule/outbox fixture. Timeline không có ID trùng. Mobile scrollWidth không vượt viewport. Ảnh demo-workflow.png, demo-digest.png, demo-dlq.png, demo-mobile.png trong docs/images đã được mở xem, không phải ảnh dựng.

Browser recovery bỏ heartbeat của claim để tạo lease hết hạn, không giả vờ đó là kill process. Kill worker process thật được kiểm tra riêng trong queue.integration.test.ts trên Linux container. UI đo DOM insertion bằng MutationObserver, không đo paint/frame.

## Benchmark và restore

[Benchmark đầy đủ](benchmark-step6.md) có dữ liệu thô, máy, phiên bản và cách đo: mỗi concurrency 12 mẫu + 2 warm-up loại bỏ, HTTP fixture 200 ms/request, cùng DAG; concurrency 1 median/p95 910,89/924,27 ms, concurrency 3 486,01/500,40 ms. Throughput tuần tự tương ứng 1,095 và 2,055 run/s. Không phải production hoặc stress test nhiều run.

UI: 53 event từ 3 run success riêng, 600 ms/request, SSE poll 500 ms qua proxy; median 334 ms, p95 499 ms từ timestamp trước commit tới DOM. Bản JSON đo đầu được lưu trong docs/benchmarks; chạy lại ghi output riêng, không thay số liệu đã công bố.

Archive output/step6/demo.dump đã restore vào hub_restore_step6_verified. Trước khi tiếp tục tạo run, đối chiếu count/hash khớp cả 13 bảng: 6 migration, 1 settings, 11 digest, 11 GitHub snapshot, 1 notification attempt, 11 run, 66 node, 66 job, 68 execution attempt, 1 DLQ, 1 schedule, 1 scheduled delivery, 235 event. Đây là snapshot lúc backup, không phải đếm run sau các lần thử bổ sung. Đã thử thêm backup/restore bằng powershell.exe 5.1 sang DB khác. Restore không khởi động scheduler hoặc gửi outbox từ backup.

## Lệnh tái lập

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
docker compose -f tests/portfolio/compose.yaml up -d --build --wait
docker compose -f tests/portfolio/compose.yaml exec -T api sh -c 'TEST_DATABASE_URL="$DATABASE_URL" pnpm test:integration'
```

Browser/proxy và kịch bản video: [demo.md](demo.md). Benchmark: [benchmark-step6.md](benchmark-step6.md). Backup/restore, retention dry-run/apply: [operations.md](operations.md). Dừng demo bằng `docker compose -f tests/portfolio/compose.yaml stop`; giữ volume và các database restore để người dùng xem lại.

## Chưa kiểm chứng

- Push điện thoại thật, Internet/credential người dùng, RSS/Open-Meteo/GitHub live trong bước 6.
- Lịch qua đêm thực, suspend/resume máy dài ngày, load/soak nhiều giờ, nhiều API replica, client TCP đọc chậm lâu hoặc tải tối đa 100 SSE client.
- Firefox/Safari, điện thoại thật, proxy công khai/TLS; ứng dụng chỉ localhost và chưa có auth.
- Restore dữ liệu lớn, PITR, backup tự động/mã hóa/offsite. Chưa quay/xuất video; chỉ bàn giao kịch bản 2–3 phút và ảnh.

## Giới hạn thiết kế và còn lại

At-least-once job execution; HTTP fetch có thể lặp sau crash. Lease token chặn ghi muộn; không hứa exactly-once push khi mất phản hồi. SSE có thể lặp, frontend dedup; event đã dọn không replay được mà phải snapshot/reset. Retention chạy tay theo batch, không tự chạy; node output/digest/GitHub snapshot/DLQ/notification còn tăng. Chưa auth, public hosting, Cron tùy ý, webhook/editor DAG hoặc điều phối quota GitHub đa worker.

Stack chính chưa được nâng cấp, không sửa `.env`/volume. Muốn áp dụng: dừng web/API/worker/scheduler rồi `up -d --build --wait` theo README; migration 006 chạy trước tiến trình ghi. Không có commit/push.
