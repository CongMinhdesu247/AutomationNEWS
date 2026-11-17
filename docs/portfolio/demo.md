# Demo portfolio — 2 phút 50 giây

## Môi trường an toàn và nhãn dữ liệu

```powershell
docker compose -f tests/portfolio/compose.yaml up -d --build --wait
```

Mở http://127.0.0.1:8099. Banner vàng **DEMO FIXTURE** hiển thị trên mọi trang; RSS, địa điểm và repository đều có nhãn mô phỏng. PostgreSQL localhost:54359, API fixture localhost:3003, volume `hub-step6-demo_step6_data`. Không dùng `.env` cá nhân, không chạy scheduler cá nhân, không gọi Internet hay gửi ntfy thật. API production không đăng ký `/api/demo/*`; entry point fixture còn yêu cầu PORTFOLIO_FIXTURE=1 và database tên step6.

Demo dùng worker service class thật trong tiến trình API fixture để dễ điều khiển; stack chính vẫn tách API/worker/scheduler. Schedule tick/delivery được kích có kiểm soát trong DB demo, không giả vờ là đã chờ lịch qua đêm. Recovery demo là bỏ heartbeat một claim, không kill tiến trình. Integration test kiểm tra kill worker process thật riêng.

Các lệnh điều khiển chỉ dùng trên port 8099:

```powershell
$demo = 'http://127.0.0.1:8099'
# Các request sau chỉ tác động fixture, không thay lịch cá nhân.
Invoke-RestMethod "$demo/api/demo/mode" -Method Post -ContentType 'application/json' -Body '{"mode":"success","latencyMs":1500}'
```

## Kịch bản quay

| Thời gian | Màn hình/thao tác | Lời dẫn |
| --- | --- | --- |
| 0:00–0:20 | Banner fixture, trang cấu hình | “Hub gom RSS, thời tiết và GitHub thành một bản tin. Đây là dữ liệu mô phỏng, chạy hoàn toàn cục bộ.” |
| 0:20–0:40 | Sửa tên địa điểm, lưu, reload | “Cấu hình được validate hai phía và lưu PostgreSQL; mỗi run chụp snapshot riêng.” |
| 0:40–1:00 | Tạo bản tin ngay, mở tiến độ; mode success latency 1500 | “API trả 202. Ba nhánh chạy song song; gộp all_settled và lưu bản tin. Timeline nhận SSE.” |
| 1:00–1:25 | Mode retry, tạo run mới | “503 được lên lịch retry trong queue, worker không sleep giữ slot. Nguồn khác vẫn hoàn tất.” |
| 1:25–1:50 | Mode dlq, tạo run, mở Lịch & tác vụ lỗi; đổi success rồi bấm Tạo run chạy lại | “Lỗi permanent vào DLQ. Bản tin vẫn partial; replay tạo run mới, giữ lịch sử cũ.” |
| 1:50–2:15 | Pause → tạo run → abandon-lease → resume | “Claim này mất heartbeat. Worker thu hồi sau lease, tạo attempt mới; token cũ không được ghi kết quả.” |
| 2:15–2:35 | Mode success, tạo run; DevTools Offline rồi Online, reload | “Event lưu cùng transaction. Cursor cho phép replay khi reconnect; giao diện bỏ trùng và lấy snapshot khi lịch sử đã bị dọn.” |
| 2:35–2:50 | Mở bản tin và báo cáo benchmark | “Benchmark fixture có 12 mẫu mỗi concurrency, median 910,9 và 486,0 ms. Đây không phải số liệu API production.” |

Lệnh đổi tình huống trước khi tạo run mới, đợi run trước terminal:

```powershell
Invoke-RestMethod "$demo/api/demo/mode" -Method Post -ContentType 'application/json' -Body '{"mode":"retry","latencyMs":1000}'
# 503 ở request weather đầu, sau đó thành công.
Invoke-RestMethod "$demo/api/demo/mode" -Method Post -ContentType 'application/json' -Body '{"mode":"dlq","latencyMs":1000}'
# Weather HTTP 400 permanent; RSS/GitHub vẫn có dữ liệu.
Invoke-RestMethod "$demo/api/demo/mode" -Method Post -ContentType 'application/json' -Body '{"mode":"success","latencyMs":1500}'
```

Thử recovery có kiểm soát:

```powershell
Invoke-RestMethod "$demo/api/demo/pause" -Method Post
$run = Invoke-RestMethod "$demo/api/digests" -Method Post -Headers @{'Idempotency-Key'=[guid]::NewGuid().ToString()}
Invoke-RestMethod "$demo/api/demo/abandon-lease" -Method Post
# Mở /#/runs/<run.runId>, đợi >1,8 giây rồi tiếp tục:
Invoke-RestMethod "$demo/api/demo/resume" -Method Post
```

Ở demo, mode success/retry/dlq inject HTTP fixture nhưng vẫn dùng connector parse/validate, queue, engine, transaction, digest store và SSE thực. Không chỉnh trực tiếp node status để làm đẹp video. Hình trong docs/images được chụp từ luồng này, không phải mockup. Kịch bản được cung cấp; chưa quay/xuất file video.

## Kiểm tra browser và proxy tái lập

```powershell
New-Item -ItemType Directory -Force output/step6 | Out-Null
npx --yes --package @playwright/cli playwright-cli -s=hub-step6 open http://127.0.0.1:8099
npx --yes --package @playwright/cli playwright-cli -s=hub-step6 run-code --filename tests/portfolio/browser.cjs
node tests/portfolio/proxy-smoke.mjs
npx --yes --package @playwright/cli playwright-cli -s=hub-step6 close
```

Browser script chỉnh/lưu/reload cấu hình; tạo 3 run đo UI; xem/reload bản tin; offline/reconnect; retry; DLQ replay; abandon lease/recovery; tạo scheduled run và ntfy fixture; kiểm tra mobile và chụp ảnh. Nó tạm bật lịch **trong DB fixture**, gọi tick đến hạn, rồi tắt lại. Nếu ngày đó đã có scheduled run, kiểm tra lại run/delivery cũ và không gửi thêm. Nên chạy khi không có người thao tác cùng DB demo. Browser cần Chrome/Chromium và Playwright CLI có thể được npx tải; không phải dependency production. Đây là function expression cho run-code, không chạy bằng node trực tiếp.

Dừng mà giữ dữ liệu:

```powershell
docker compose -f tests/portfolio/compose.yaml stop
```

Không dùng down -v. Nếu cần một lần nghiệm thu hoàn toàn mới, dừng stack demo trước rồi dùng tên project mới bằng `docker compose -p hub-step6-review -f tests/portfolio/compose.yaml up -d --build --wait`; khi dừng/exec/cp phải dùng cùng `-p`. Không chia sẻ port với stack demo đang chạy.

## CV bullets (English)

Ba bullet được chốt cho bản chuẩn bị v1.0.0 cùng GitHub description ở [portfolio.md](portfolio.md). Các số liệu giữ nguyên giới hạn fixture và bằng chứng kiểm chứng.

## Chạy demo ở port riêng khi đã có bản khác

Không dừng project đang được sử dụng. Giữ các biến này trong cùng terminal cho mọi lệnh Compose của project thử:

```powershell
$env:DEMO_DB_PORT = '54369'
$env:DEMO_API_PORT = '3004'
$env:DEMO_WEB_PORT = '8109'
docker compose -p hub-v1-demo -f tests/portfolio/compose.yaml up -d --build --wait
npx --yes --package @playwright/cli@0.1.24 playwright-cli -s=hub-v1 open http://127.0.0.1:8109
npx --yes --package @playwright/cli@0.1.24 playwright-cli -s=hub-v1 run-code --filename tests/portfolio/browser.cjs
$env:DEMO_BASE_URL = 'http://127.0.0.1:8109'
node tests/portfolio/proxy-smoke.mjs
docker compose -p hub-v1-demo -f tests/portfolio/compose.yaml stop
Remove-Item Env:DEMO_DB_PORT,Env:DEMO_API_PORT,Env:DEMO_WEB_PORT,Env:DEMO_BASE_URL
```

Browser script dùng origin của tab đã mở, phải mở đúng URL demo trước; `/api/demo/mode` không tồn tại trên API production và sẽ làm script dừng nếu mở nhầm ứng dụng. Mặc định các port cũ 54359/3003/8099 được giữ. Khi dùng port tùy chọn, đặt `$demo` trong phần lệnh quay video bằng origin tương ứng. Mỗi project có named volume riêng, không xóa volume cũ để chạy lại.

Nội dung CV và GitHub description chính thức cho bản chuẩn bị v1.0.0 ở [portfolio.md](portfolio.md); kết luận phát hành ở [release-readiness.md](release-readiness.md). Kịch bản video bên trên vẫn giữ nhãn fixture và thời lượng 2 phút 50 giây.

## Hồi quy DNS khi API đổi IP (chỉ project nghiệm thu)

Sau khi khởi động các project thử với các port riêng bên trên, có thể tái chạy kiểm tra đã phát hiện lỗi 502 khi recreate API. Chạy từ thư mục source thử và dùng `.env` thử của project review:

```powershell
$env:WEB_PORT = '8108'
./tests/portfolio/proxy-dns.ps1 -Project hub-v1-review -BaseUrl http://127.0.0.1:8108
Remove-Item Env:WEB_PORT
# Với hub-v1-demo, giữ các biến DEMO_*_PORT của project trong cùng terminal:
./tests/portfolio/proxy-dns.ps1 -Project hub-v1-demo -BaseUrl http://127.0.0.1:8109 -ComposeFile tests/portfolio/compose.yaml -EnvFile ''
```

Script chỉ nhận hai tên project nghiệm thu này, xác nhận nhãn container, recreate API stateless và giữ tạm IP cũ bằng container timer fixture để buộc IP mới. Không xóa DB/volume; dọn holder của chính test khi xong. Nó không phải thao tác demo trên dữ liệu cá nhân. Sau kiểm tra, chạy lại proxy-smoke/browser để kiểm REST và SSE qua Nginx. Trong lần v1.0.0, cả hai project đã phục hồi REST và SSE smoke qua sau thay IP; luồng browser fixture cũng được chạy lại.
