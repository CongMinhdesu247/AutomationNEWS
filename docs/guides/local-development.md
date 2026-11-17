# Chạy cục bộ và kiểm thử

Chạy các lệnh PowerShell tại thư mục gốc. Cần Node.js 24, pnpm 11.25.0 và Docker với Linux containers/Compose v2.

## Chuẩn bị

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm install --frozen-lockfile
```

Chỉnh `.env` trước khi khởi tạo database: đặt `POSTGRES_PASSWORD` riêng, đồng bộ `POSTGRES_USER`, `POSTGRES_DB` và `DATABASE_URL`. Với cấu hình Compose hiện tại, dùng mật khẩu gồm chữ, số, dấu gạch ngang hoặc gạch dưới. Development kết nối database tại `127.0.0.1:54329`; đổi `DB_PORT` thì sửa cả URL.

Đặt `APP_ORIGIN=http://127.0.0.1:5173` cho Vite hoặc `http://127.0.0.1:8088` cho Docker mặc định. Giữ `REGISTRATION_OPEN=false` đến khi tạo quản trị viên. `.env` và token chỉ nằm cục bộ; không dùng tiền tố `VITE_` cho secret.

## Development

```powershell
docker compose --env-file .env -f infra/compose.yaml -f infra/compose.dev.yaml up -d --wait db
pnpm migrate
pnpm dev
```

Mở [dashboard](http://127.0.0.1:5173). Lệnh `pnpm dev` chạy web, API, worker và scheduler. Vite proxy `/api` đến `127.0.0.1:3001`. Khi có migration mới, dừng các tiến trình ghi rồi chạy `pnpm migrate` trước khi khởi động lại.

Dừng development bằng Ctrl+C; dừng database và giữ dữ liệu:

```powershell
docker compose --env-file .env -f infra/compose.yaml -f infra/compose.dev.yaml stop db
```

## Chạy toàn bộ bằng Docker

```powershell
docker compose --env-file .env -f infra/compose.yaml up -d --build --wait
```

Mở [dashboard Docker](http://127.0.0.1:8088). Migration tự chạy trước các dịch vụ ứng dụng. Dừng bằng `docker compose --env-file .env -f infra/compose.yaml stop` để giữ volume.

## Tạo quản trị viên cục bộ

Thêm `OWNER_EMAIL` vào `.env`. Tạo thư mục `secrets/` và dùng trình soạn thảo tạo `secrets/owner_password` chứa mật khẩu 12–128 ký tự, sau đó chạy:

```powershell
docker compose --env-file .env -f infra/compose.yaml -f infra/compose.home.yaml run --rm --build owner
Remove-Item -LiteralPath secrets/owner_password
```

Đăng nhập bằng tài khoản vừa tạo tại origin đã cấu hình. Chỉ tài khoản tạo qua owner CLI mới có quyền quản trị; đăng ký thông thường tạo thành viên. Lệnh owner dùng database trong Docker; development phải trỏ đến cùng database để dùng tài khoản này.

## Kiểm thử

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Integration test dùng PostgreSQL thử riêng, không trỏ vào database production:

```powershell
docker compose -f tests/accounts/compose.yaml up -d --wait db
$env:TEST_DATABASE_URL = 'postgresql://accounts_test:fixture_only@127.0.0.1:54369/accounts_test'
try {
    pnpm test:integration
} finally {
    Remove-Item Env:TEST_DATABASE_URL
    docker compose -f tests/accounts/compose.yaml stop
}
```

Unit test dùng fixture/mock; integration test tạo schema tạm trong database thử. Các kịch bản browser/proxy riêng nằm trong `tests/`; tra [báo cáo kiểm chứng](../README.md#kiểm-chứng) để xem phạm vi và giới hạn.

## Cập nhật hệ thống hiện có

Giữ `.env` và volume. Thay `POSTGRES_PASSWORD` trong file không tự đổi mật khẩu role của database đã khởi tạo. Không dùng `down -v` để xử lý lỗi kết nối. Với server đang public, làm theo [runbook cập nhật, backup và rollback](premium-release.md); hướng dẫn cài mới không thay thế quy trình nâng cấp.
