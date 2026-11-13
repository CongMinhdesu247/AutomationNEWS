# Nội dung portfolio v1.0.0

## GitHub repository description (English)

Self-hosted personal digest hub with a TypeScript DAG engine, PostgreSQL job queue, retries and recovery, timezone scheduling, and durable SSE telemetry. React + Fastify; localhost-only.

Đây là mô tả để chủ repository tự đặt, chưa được ghi vào GitHub. Chưa gắn nhãn open-source khi giấy phép phân phối chưa được chọn.

## Three CV bullets (English)

- Built a self-hosted personal digest hub using React, Fastify and TypeScript, combining RSS, weather and GitHub data through a versioned six-node DAG with isolated source failures and PostgreSQL persistence.
- Implemented a PostgreSQL-backed queue with lease fencing, heartbeat recovery, retry/DLQ replay, idempotent writes and durable SSE reconnect; validated behavior with 61 unit tests, 40 PostgreSQL integration tests and browser fixture flows.
- Benchmarked the same DAG at worker concurrency 1 and 3 using deterministic 200 ms HTTP fixtures, reducing median completion time from 910.9 ms to 486.0 ms across 12 measured runs per configuration; documented a reproducible methodology and raw fixture results.

“Validated” ở đây chỉ các đường code được chạy bằng fixture/PostgreSQL/browser trong [release-readiness](release-readiness.md). Không nhận là đã vận hành production, đã kiểm chứng ba buổi sáng, có exactly-once delivery hoặc có push điện thoại thật. Số liệu benchmark tham chiếu [báo cáo bước 6](benchmark-step6.md), không phải benchmark API công khai hoặc phép đo mới trong lần chuẩn bị v1.0.0.

## Video và ảnh

[Kịch bản 2 phút 50 giây](demo.md) dùng môi trường DEMO FIXTURE riêng: song song → lỗi/retry → DLQ replay → abandoned lease/recovery → SSE offline/reconnect. Video chưa được quay/xuất file. Không mô tả abandoned claim như kill process; kill worker thật được chứng minh riêng bằng integration test.

Ảnh dùng trong README nằm ở docs/images, có banner dữ liệu mô phỏng. Bản chụp nghiệm thu mới và log/tool reports ở output/release-v1-review, không đưa cả thư mục output vào repository hoặc ZIP public.

## Trước khi đưa vào CV/GitHub

- Xem lại tên/email tác giả trong Git metadata và chọn giấy phép nếu muốn công bố.
- Chạy [checklist ba buổi sáng](morning-checklist.md) để bổ sung bằng chứng live; chưa đánh dấu sẵn.
- Chọn các thay đổi v1.0.0 và bước 6 cần đưa vào commit. Hiện có file mới chưa tracked; chỉ đẩy commit cũ sẽ thiếu các artifact này.
- Chủ repository tự quyết định commit/tag/release/push và quyền hiển thị. Không có thao tác công khai nào được thực hiện trong lần chuẩn bị này.

