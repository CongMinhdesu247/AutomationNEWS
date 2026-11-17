# Xác minh bước 5 — SSE telemetry

Ngày bàn giao: 12/11/2026 (Asia/Saigon). Môi trường: Windows PowerShell, Node 24, pnpm 11.25.0, Vitest 5.1.0, Docker Linux containers, PostgreSQL 17 và Nginx thật.

## Phân tách dữ liệu

Dùng Docker project `hub-step5-test`, database riêng ở localhost:54349, API fixture localhost:3002, Nginx localhost:8098. Database có named volume riêng. Integration test tạo schema UUID riêng rồi chỉ dọn schema của mình. Không migrate database ứng dụng chính, không đổi `.env`, không xóa volume. Không gọi RSS/Open-Meteo/GitHub hay gửi ntfy thật. Fixture weather trả lỗi 503 rồi thành công; fixture recovery làm lease hết hạn có kiểm soát. Route `/__fixture/start` chỉ được mount vào server thử, không có trong entry point production.

## Kết quả đã chạy

| Kiểm tra | Kết quả |
| --- | --- |
| `pnpm install --frozen-lockfile` | Qua, lockfile không đổi |
| `pnpm typecheck` | Qua toàn bộ workspace |
| `pnpm test` | 61/61 qua |
| `pnpm build` | Qua, có production bundle web |
| `pnpm test:integration` trên PostgreSQL thử | 36/36 qua, gồm 8 test telemetry mới |
| Build và chạy Docker API/web fixture | Qua; web dùng Nginx thật và cấu hình proxy của dự án |
| Smoke SSE qua localhost:8098 | Nhận sync terminal=false trước EOF, reconnect Last-Event-ID chỉ nhận sequence lớn hơn cursor, nhận terminal sync |
| Chromium qua Playwright CLI | Tạo run, offline/reconnect, retry/recovery/terminal, reload và desktop/mobile đều qua |

Vitest trong image chạy bằng user không có quyền ghi module cache đã báo EACCES và tiếp tục không dùng disk cache; không có test bị bỏ qua vì cảnh báo này.

Các kiểm tra telemetry bao gồm:

- Rollback không để lại event, counter hoặc state; payload quá 4 KiB bị database từ chối; secret/Authorization/raw response không xuất hiện trong event.
- Ba node kết thúc đồng thời vẫn có sequence liên tiếp duy nhất. Bộ queue cũ vẫn kiểm tra compose chỉ enqueue một lần, stale lease bị từ chối và kill worker process thật rồi phục hồi.
- Snapshot/cursor/history nhất quán khi transition commit song song; event commit giữa snapshot và mở stream được replay. Last-Event-ID ưu tiên query cursor.
- Stream có run/node started/succeeded/failed/skipped, retry, recovery và terminal; lỗi nội bộ persist dẫn đến run.failed.
- Replay lịch sử hơn 125 event qua nhiều batch; snapshot/UI giữ tối đa 100. Frontend bỏ duplicate, không rollback state vì event cũ và phát hiện gap.
- UUID sai, run không tồn tại, cursor sai/cross-run được từ chối trước stream; future cursor và lịch sử có gap gửi reset. Không thay dữ liệu vì cursor sai.
- Hai client dùng chung batch đọc, heartbeat được phát, không chiếm database connection riêng theo client. Disconnect dọn timer/listener; capacity và giới hạn socket buffer có unit test. Client mới vào lúc query đang chờ không bị reset nhầm.

Lần chạy đầy đủ đã phát hiện replay burst có thể chạm buffer cap trước native highWaterMark và đóng cả client khỏe. Đã sửa bằng đợt gửi khoảng 16 KiB, nhường vòng I/O, giữ xử lý drain/buffer cap và chạy lại toàn bộ integration thành công.

## Tái chạy bằng PowerShell

Từ thư mục gốc, không cần `.env` production cho stack thử:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
docker compose -f tests/telemetry/compose.yaml up -d --build --wait
docker compose -f tests/telemetry/compose.yaml exec -T api sh -c 'TEST_DATABASE_URL="$DATABASE_URL" pnpm test:integration'
New-Item -ItemType Directory -Force output/step5 | Out-Null
npx --yes --package @playwright/cli playwright-cli -s=hub-step5 open http://127.0.0.1:8098
npx --yes --package @playwright/cli playwright-cli -s=hub-step5 run-code --filename tests/telemetry/browser.cjs
node tests/telemetry/proxy-smoke.mjs
npx --yes --package @playwright/cli playwright-cli -s=hub-step5 close
docker compose -f tests/telemetry/compose.yaml stop
```

Playwright cần Chrome/Chromium có sẵn. `browser.cjs` là function expression cho `run-code`, không phải chương trình Node chạy độc lập. Trước khi chạy lại browser fixture trong cùng stack, `docker compose -f tests/telemetry/compose.yaml restart api` để reset fixture worker/counter; giữ volume. Chạy browser trước proxy smoke để khởi động worker fixture. Nếu lần thử bị ngắt giữa chừng, hoàn tất các run cũ trước khi lặp để fixture claim đúng run mới. Port 3002/54349/8098 cần trống.

Script kiểm tra browser xác nhận chỉ có một REST snapshot trước reload (không polling), các ID timeline duy nhất, nhận retry và recovery xảy ra lúc offline, không mở lại stream sau terminal sync, reload giữ cùng run và lịch sử. Desktop 1440×1100 và mobile 390×844 không tràn ngang. Ảnh đã xem: `output/step5/desktop.png`, `output/step5/mobile.png`; output được gitignore.

## Giới hạn kiểm chứng và vận hành

Chưa chạy soak test hàng giờ, tải tối đa 100 client hoặc nhiều API replica; chưa kiểm tra Firefox/Safari, thiết bị di động thật, proxy khác hoặc mạng di động. Backpressure được kiểm ở mức write/buffer và replay thực, chưa mô phỏng client TCP đọc cực chậm trong thời gian dài. Browser dùng offline/online mô phỏng, không ngắt router vật lý.

Event store chưa retention, dung lượng PostgreSQL tăng theo lịch sử. Các giới hạn tài nguyên và giao thức snapshot/cursor/reset nằm trong architecture.md và README. Lịch sử run trước migration không được backfill. Giao sự kiện có thể lặp, UI dedup theo sequence; không có exactly-once delivery.

Đã dừng stack thử sau xác minh, giữ named volume và dữ liệu thử. Container ứng dụng chính đang chạy chưa được thay image hoặc migrate bước 5. Áp dụng bằng hai lệnh nâng cấp trong README; migration 005 chạy trước các tiến trình ứng dụng. Không có commit/push.
