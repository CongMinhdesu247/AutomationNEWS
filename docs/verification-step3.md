# Xác minh bước 3

Ngày: 11/11/2026, Asia/Saigon.

## Kiểm tra code và database

- pnpm install --frozen-lockfile: đạt cho workspace sáu package.
- pnpm typecheck: đạt với TypeScript strict cho contracts, engine, API, worker và web.
- pnpm build: đạt; web tạo bundle production, backend/worker chạy bằng tsx sau typecheck.
- pnpm test: 48 test đạt, gồm bốn test engine cho DAG/topo/cycle/ID/edge, nhánh độc lập/concurrency, all_success/all_settled và skipped propagation; giữ 44 test validation/connector bước trước.
- pnpm test:integration: 17 test đạt trên PostgreSQL 17 thật, trong ba schema tạm riêng, không gọi ntfy hoặc nguồn ngoài.
- Migration 003 được áp dụng vào database development hiện có và chạy lại; settings JSON và danh sách digest ID trước/sau không đổi. Không sửa 001/002, không xóa volume/dữ liệu người dùng.

## Các tình huống queue đã xác minh bằng PostgreSQL thật

- Request đồng thời cùng key chỉ tạo một run và một root job; node unique đúng sáu node. Cùng payload chuẩn hóa trả cùng run, khác payload trả 409.
- Chỉnh settings sau submit không đổi snapshot run. Key thuộc bản tin bước 2 trả conflict để không tạo bản tin trùng sau nâng cấp.
- Hai worker không claim cùng một lease hợp lệ. Sau root, ba nhánh có thể được xử lý độc lập.
- Ba nhánh hoàn tất đồng thời chỉ enqueue một compose job và không bỏ quên downstream.
- Lease hết hạn → attempt interrupted → claim token mới, cùng logical job. Worker cũ không heartbeat hoặc ghi output muộn được.
- Node thời tiết/GitHub đã thành công không gọi lại connector khi worker mới tiếp tục RSS đang gián đoạn.
- Hết giới hạn phục hồi đưa node về failed/RECOVERY_LIMIT; lỗi connector bình thường chỉ có một attempt, không tự retry.
- Late persist bị từ chối, không ghi snapshot; cố ý replay persist bằng trạng thái quản trị vẫn chỉ có một digest và snapshot nhờ unique/ON CONFLICT.
- Trigger PostgreSQL cố ý làm INSERT chậm đến hết lease: transaction rollback cả digest và snapshot.
- Trigger từ chối lưu digest: node/run failed, lỗi được làm sạch và không lộ chi tiết PostgreSQL.
- Heartbeat thật gia hạn lease, mất token khiến executor abort. Worker concurrency=1 chỉ claim một job, hai nhánh còn queued; shutdown giới hạn để công việc chưa hoàn tất được phục hồi.
- Một nguồn lỗi/hai nguồn thành công vẫn lưu digest partial; mọi nguồn lỗi vẫn có digest failed nhưng workflow completed nếu persist thành công.

## Kill worker process thật

Integration khởi động một Node/tsx worker con với HTTP fixture bị chặn và PostgreSQL thật. Sau khi nhận tín hiệu FETCH_STARTED, test kill process bằng SIGKILL/TerminateProcess, chờ lease thực sự hết theo clock PostgreSQL rồi khởi động worker thay thế. Kết quả: workflow hoàn tất, weather có hai attempt, root chỉ một attempt và attempt bị giết được ghi interrupted. Không kết luận locking từ mock.

## Trình duyệt thật

Playwright/Chromium dùng schema PostgreSQL riêng và HTTP fixture có nhãn [Fixture], không đưa dữ liệu giả vào database ứng dụng:

1. Bấm Tạo bản tin ngay, xác nhận response 202 và chuyển sang URL run ID.
2. Worker fixture đang dừng: run queued; reload vẫn hiện đúng run.
3. Cho worker chạy, dashboard tự cập nhật sáu node và link Mở bản tin đã lưu.
4. Sau terminal, theo dõi request thêm 4,5 giây: không còn polling run.
5. Mở digest rồi reload: nội dung vẫn được đọc từ database.
6. Chụp và xem layout desktop 1440px và mobile 390px; không tràn ngang.

Ảnh: output/playwright/step3-desktop.png và step3-mobile.png (gitignore). Fixture server đã đóng và schema riêng được dọn; không có fixture trong database ứng dụng.

## Vận hành và giới hạn xác minh

Dockerfile có target worker chạy Node trực tiếp qua tsx loader và init để nhận signal; Compose giữ named volume, chỉ publish web localhost. Đã build image API/web/worker và migration. API/database/web healthy, worker ở trạng thái Up và ghi log khởi động. Endpoint ready và GET runs qua Nginx đạt; Chromium đã mở trang runs production. Bộ 17 integration test cũng đạt trong API container Linux, gồm kill worker process thật. Đã dừng và khởi động lại worker service theo README khi queue ứng dụng rỗng.

Chưa kiểm tra mất điện toàn máy/PostgreSQL crash hoặc network partition kéo dài; đã kiểm tra worker chết và lease/token/transaction trên PostgreSQL thật. Chưa kiểm tra tải dài ngày, Firefox/Safari hoặc điện thoại thật. Không gửi ntfy thật, không thêm tự động gửi. Bản này at-least-once execution, không exactly-once; chưa có retry theo loại lỗi/backoff/DLQ/Cron/webhook/SSE. Retention/backup và quota GitHub phối hợp nhiều worker chưa triển khai.

Không tạo commit hoặc push.
