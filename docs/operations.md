# Vận hành: backup, restore và retention

Các lệnh chạy từ thư mục gốc trong PowerShell 5.1/7. Backup dùng `pg_dump -Fc` bên trong container PostgreSQL rồi `docker compose cp` ra file: không chuyển binary qua `>` hoặc pipeline PowerShell. Không cần cài PostgreSQL client trên Windows.

## Backup

```powershell
./scripts/backup.ps1 -OutputFile output/backups/hub-manual.dump
```

Script dùng `.env` và `infra/compose.yaml`, từ chối ghi đè file. Archive lưu schema/data/migration, không chứa role/password database hoặc `.env`. Settings, URL/topic riêng và nội dung bản tin vẫn là dữ liệu cá nhân: giữ archive ở nơi riêng, dùng mã hóa của ổ đĩa/công cụ backup khi cần. `*.dump` được gitignore. Muốn backup hằng ngày cần tự cấu hình tác vụ ngoài; bản này không thêm lịch backup.

`pg_dump` lấy snapshot nhất quán khi ứng dụng vẫn ghi; để so sánh toàn bộ dữ liệu sau restore, dừng worker/scheduler/API trong thời gian chụp và đối chiếu. Backup logic này không phải PITR, không lưu role hay cấu hình Docker. Xem [pg_dump PostgreSQL 17](https://www.postgresql.org/docs/17/app-pgdump.html).

## Restore vào database mới

```powershell
./scripts/restore.ps1 -BackupFile output/backups/hub-manual.dump -Database hub_restore_review
```

Chỉ chấp nhận tên `hub_restore_...`, tạo database mới từ template0 và từ chối nếu đã tồn tại. Không dùng DROP/--clean, không đè database người dùng. `pg_restore --single-transaction --exit-on-error --no-owner --no-acl` áp dụng archive nguyên tử; nếu lỗi, database mới có thể còn tồn tại nhưng không có restore một phần đã commit. Script không tự xóa database để chạy lại. Chỉ restore archive đáng tin cậy do chính bạn tạo; dump có thể chứa SQL thực thi. Xem [pg_restore PostgreSQL 17](https://www.postgresql.org/docs/17/app-pgrestore.html).

Để đưa database đã restore vào dùng: dừng mọi tiến trình ghi, đặt DATABASE_URL tới database mới trong môi trường riêng, chạy migration, kiểm tra rồi mới khởi động worker/scheduler. Không chạy scheduler/outbox vừa restore tới ntfy thật khi chưa rà soát các delivery pending/sending. Script không tự đổi `.env`, không khởi động ứng dụng với database mới và không thay mật khẩu role.

Thử trên demo riêng, không dùng `.env` cá nhân:

```powershell
./scripts/backup.ps1 -ComposeFile tests/portfolio/compose.yaml -EnvFile '' -OutputFile output/step6/demo.dump
./scripts/restore.ps1 -ComposeFile tests/portfolio/compose.yaml -EnvFile '' -BackupFile output/step6/demo.dump -Database hub_restore_review
# Chạy trong API fixture; source DB cần ngừng tạo run để đối chiếu hash ổn định.
docker compose -f tests/portfolio/compose.yaml exec -T api sh -c 'TEST_DATABASE_URL="$DATABASE_URL" RESTORE_DATABASE_URL="postgresql://step6:fixture_only@db:5432/hub_restore_review" pnpm --filter @hub/api exec tsx src/operations/verify-restore.ts'
```

`verify-restore.ts` chỉ dùng cho DB thử nhỏ: đối chiếu count và hash toàn bộ hàng của 13 bảng, không in nội dung cá nhân. String aggregation không phù hợp DB lớn; production cần kiểm kê/đối soát theo từng bảng hoặc batch. Không migrate source sau dump trước khi đối chiếu.

## Retention theo batch

Migration 006 bổ sung watermark `events_pruned_through`, bộ đếm `attempts_pruned` và index run terminal theo completed_at. Không sửa migration cũ.

```powershell
# Mặc định chỉ xem batch sắp dọn, không ghi:
pnpm retention --event-days=30 --attempt-days=90 --batch=500
# Chủ động áp dụng đúng một batch:
pnpm retention --apply --event-days=30 --attempt-days=90 --batch=500
```

Trong Docker:

```powershell
docker compose --env-file .env -f infra/compose.yaml exec -T api pnpm --filter @hub/api retention --event-days=30 --attempt-days=90 --batch=500
# Thêm --apply sau khi đã xem kết quả dry-run và có backup.
```

Mỗi lần khóa tối đa một run **completed/failed**, dùng SKIP LOCKED và transaction ngắn; mỗi loại xóa tối đa batch (1–1000) hàng. Tuổi tính từ thời điểm kết thúc run theo giờ database: event mặc định 30 ngày, execution attempt log 90 ngày. Run queued/running, attempt running, bản tin, node input/output, DLQ và notification history được giữ. Không có cron dọn ngầm. Muốn dọn hết backlog, chạy lại từng batch tới khi events=0 và attempts=0; nếu có cleaner khác đang giữ khóa, kết quả 0 có thể chỉ là tạm thời. Dry-run đếm batch hiện tại, không phải tổng toàn database.

Xóa event theo prefix sequence số và cập nhật watermark trong cùng transaction. Không đặt lại `event_sequence`. Cursor thấp hơn watermark nhận SSE `reset/CURSOR_EXPIRED`; frontend tải snapshot/cursor mới. Cursor đúng watermark vẫn replay phần còn lại. Snapshot terminal và bản tin tồn tại dù đã xóa toàn bộ event. Tổng số attempt trên UI được giữ nhờ `attempts_pruned + count(log còn lưu)`; chi tiết lỗi/thời gian của attempt đã dọn không còn truy xuất được. Dữ liệu đã dọn chỉ phục hồi từ backup.

Các container trong Compose chính giới hạn log json-file 10 MiB × 3 file/service. Đây là rotation log tiến trình theo dung lượng, không xóa trạng thái run PostgreSQL. Áp dụng khi recreate container; không thực hiện trên stack cá nhân trong kiểm thử. Log application không ghi token/header/raw payload. Chưa tự dọn node input/output, digest, GitHub snapshots hoặc notification history; theo dõi dung lượng và thiết kế retention tiếp nếu cần.
