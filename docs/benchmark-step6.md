# Benchmark bước 6 — fixture, không phải hiệu năng production

Đo ngày 12/11/2026, Asia/Saigon. Dữ liệu thô: [workflow samples](benchmarks/step6.json), [UI event samples](benchmarks/ui-latency-step6.json).

## Phương pháp

Chạy đúng `digest.v1` gồm start → ba nhánh → compose → persist trên PostgreSQL thật. Chỉ đổi **worker concurrency 1 hoặc 3**, giữ DAG concurrency 3 và toàn bộ workload còn lại. Inject HTTP fixture, không gọi API công khai. Mỗi HTTP request chờ 200 ms bằng timer có AbortSignal; RSS 1 request, weather 1, GitHub 2 request nối tiếp (all-time và recent). Nhánh GitHub vì vậy có tối thiểu 400 ms, hai nhánh còn lại 200 ms. Bao gồm parse RSS, validation, baseline lookup, queue/attempt/event/digest writes và snapshot reads thực.

Mỗi cấu hình có 2 warm-up loại khỏi số liệu và 12 lượt đo, tổng 24 mẫu đo + 4 warm-up. Đảo thứ tự 1/3 và 3/1 theo lượt để giảm thiên lệch cache. Mỗi lúc chỉ có một run; không có benchmark/browser/test khác chạy đồng thời trong giai đoạn đo. Các container khác vốn có trên máy vẫn chạy; không chủ động tạo tải lên chúng và không cô lập CPU. Tạo schema UUID riêng, migrate, đo rồi dọn chính schema benchmark; không sửa dữ liệu public hoặc database cá nhân.

Gọi trực tiếp WorkflowQueue.submit/get và WorkerRunner, không gồm vòng HTTP POST/GET tới API. Dùng performance.now từ trước submit tới lúc snapshot service đọc được completed, gồm thời gian submit/chờ queue/lưu DB và phát hiện hoàn tất. Worker poll 5 ms, kiểm snapshot 5 ms, heartbeat 1000 ms, không retry lỗi. Đây là cấu hình benchmark, khác mặc định worker poll 1000 ms. Throughput = số run đo / tổng thời gian hoàn tất các run đo, **không phải tải tối đa khi nhiều run tranh queue**. Warm-up, khoảng idle giữa lượt và thời gian dựng schema không nằm trong throughput. Percentile dùng nearest rank ceil(n×p); median là p50 theo quy ước này (không lấy trung bình hai phần tử giữa). Với n=12, p95 là mẫu chậm nhất nên chỉ mang tính mô tả bộ mẫu nhỏ.

## Máy và phiên bản thực tế

- Host: Windows 11 Pro 10.0.26300, Intel Core i5-14400F, 10 core/16 logical CPU, RAM 31,84 GiB.
- Docker Engine 29.9.2, Linux/WSL2 kernel 6.18.33.2-microsoft-standard-WSL2; Docker thấy 16 CPU và khoảng 15,53 GiB RAM. Không đặt CPU quota riêng cho container.
- Benchmark trong image Linux: Node v24.22.3, pnpm 11.25.0, PostgreSQL 17.11 Alpine; host Node v24.21.0.
- Vitest 5.1.0, Vite 8.3.8. Nginx 1.30.6 cho phép đo UI; Chromium 157 headless trên Windows, Playwright CLI 0.1.24.
- Images dùng tag ổn định, có thể thay patch khi build lại; phiên bản đo thực nằm trong JSON. Lockfile pnpm được giữ nguyên.

## Kết quả

| Worker concurrency | Mẫu | Median (ms) | p95 (ms) | Throughput (run/s) | Median throughput (run/s) | p95 throughput (run/s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 12 | 910,89 | 924,27 | 1,095 | 1,097 | 1,104 |
| 3 | 12 | 486,01 | 500,40 | 2,055 | 2,052 | 2,110 |

Median giảm khoảng **46,6%** (tỉ lệ 1,87×) trên workload này. Không suy ra thông lượng hay độ trễ RSS/GitHub/Open-Meteo production. Một HTTP fixture không mô phỏng DNS/TLS, mạng, quota hoặc kích thước response thực tế.

UI đo riêng bằng 3 run fixture thành công, 600 ms/request, worker poll 50 ms và SSE hub poll mặc định 500 ms, qua Nginx cùng origin. MutationObserver ghi thời điểm DOM xuất hiện event mới sau snapshot ban đầu; bỏ các event đã có khi gắn observer, mỗi ID chỉ tính một lần. Lấy Date.now(browser) trừ timestamp event PostgreSQL tạo **trước commit**, trên cùng máy. Không có clock đồng bộ chuyên dụng; số này gồm phần transaction, hub polling, proxy/network và React/DOM, không phải network latency thuần hoặc time-to-paint. Các sự kiện cùng batch có tương quan, không phải 53 mẫu độc lập về tải.

| Đo tới DOM | Run | Event mới | Median | p95 |
| --- | ---: | ---: | ---: | ---: |
| PostgreSQL event timestamp → DOM insertion | 3 | 53 | 334 ms | 499 ms |

## Tái lập trên PowerShell

```powershell
docker compose -f tests/portfolio/compose.yaml up -d --build --wait
docker compose -f tests/portfolio/compose.yaml exec -T api sh -c 'TEST_DATABASE_URL="$DATABASE_URL" BENCH_SAMPLES=12 FIXTURE_LATENCY_MS=200 pnpm --filter @hub/api exec tsx src/operations/benchmark.ts'
New-Item -ItemType Directory -Force output/step6 | Out-Null
docker compose -f tests/portfolio/compose.yaml cp api:/tmp/benchmark-step6.json output/step6/benchmark.json
```

Giữ máy ít tải, chạy benchmark riêng khỏi test/browser. Mỗi lần dùng schema riêng và key mới. `BENCH_SAMPLES` cho phép 5–100; `FIXTURE_LATENCY_MS` cho phép 10–2000; `BENCH_OUTPUT` đổi file bên trong container. CLI bắt buộc TEST_DATABASE_URL, không tự lấy DATABASE_URL/.env làm đích. Không dùng database người dùng cho benchmark vì nó cần quyền tạo/drop schema.

Đo UI: chạy `tests/portfolio/browser.cjs` theo [demo.md](demo.md), file mới ở output/step6/ui-latency.json. Kịch bản này còn chạy các tình huống lỗi, nhưng chỉ 3 run success đầu được đưa vào thống kê UI. Dữ liệu trong docs/benchmarks là bản đã đo và không tự bị ghi đè khi chạy lại.
