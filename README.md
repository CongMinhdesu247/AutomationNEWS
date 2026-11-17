# AutomationNEWS

Ứng dụng tổng hợp bản tin cá nhân, lên lịch tự động và gửi thông báo qua **ntfy**. Hỗ trợ nhiều tài khoản, mỗi người có tùy chọn nội dung, lịch và lịch sử riêng.

## Chức năng chính

- Tổng hợp tin RSS, thời tiết, chất lượng không khí, giá vàng/USD, xăng dầu và repository GitHub.
- Tùy chọn chủ đề, địa điểm, việc cần làm, ngày lễ và giờ nhận bản tin.
- Tạo bản tin thủ công hoặc theo lịch; xem lịch sử và tiến độ xử lý trực tiếp.
- Quản lý tài khoản, hồ sơ gia đình và gói Free/Premium; AI và khám phá nguồn là tùy chọn.

## Cấu trúc dự án

```text
apps/           Web React, API Fastify, worker và scheduler
packages/       Contracts Zod và DAG engine dùng chung
db/migrations/  Các migration PostgreSQL
infra/          Docker Compose, Dockerfile và Nginx
scripts/        Công cụ cấu hình, đóng gói, backup và restore
tests/          Môi trường và kịch bản kiểm thử tích hợp/trình duyệt
docs/           Hướng dẫn, tính năng, kiến trúc và báo cáo kiểm chứng
output/         Kết quả chạy, bản đóng gói và backup cục bộ (Git bỏ qua)
```

Các unit/integration test nằm cạnh mã nguồn trong `apps/` và `packages/`. Công nghệ chính: **TypeScript · React/Vite · Fastify · PostgreSQL · Docker Compose**.

## Chạy nhanh bản demo

Cần Docker và Compose v2 đang chạy. Tại thư mục gốc:

```powershell
docker compose -f tests/portfolio/compose.yaml up -d --build --wait
```

Mở [demo cục bộ](http://127.0.0.1:8099). Demo sử dụng dữ liệu mô phỏng và database riêng, không gửi thông báo thật. Dừng và giữ dữ liệu:

```powershell
docker compose -f tests/portfolio/compose.yaml stop
```

## Phát triển và kiểm tra

Cần **Node.js 24**, **pnpm 11.25.0** và Docker. Nếu chưa có `.env`, sao chép từ `.env.example`; đặt mật khẩu PostgreSQL riêng và cập nhật `DATABASE_URL` tương ứng. Xem [hướng dẫn chạy cục bộ](docs/guides/local-development.md) để cấu hình tài khoản và origin.

```powershell
pnpm install --frozen-lockfile
docker compose --env-file .env -f infra/compose.yaml -f infra/compose.dev.yaml up -d --wait db
pnpm migrate
pnpm dev
```

Mở [ứng dụng development](http://127.0.0.1:5173). Kiểm tra bằng `pnpm typecheck`, `pnpm test` và `pnpm build`; integration test cần PostgreSQL thử riêng theo [hướng dẫn](docs/guides/local-development.md#kiểm-thử).

## Tài liệu

- [Mục lục đầy đủ](docs/README.md) — tra cứu theo nhóm.
- [Triển khai máy chủ](docs/guides/home-server.md) · [Cập nhật, backup và rollback](docs/guides/premium-release.md) · [Vận hành](docs/guides/operations.md).
- [Kiến trúc](docs/architecture/architecture.md) · [Thiết kế Premium](docs/architecture/premium-design.md).
- [Changelog](CHANGELOG.md) · [Ghi chú lịch sử](docs/archive/project-notes.md).

Khi cập nhật hệ thống đã có dữ liệu, giữ nguyên `.env` và volume; làm theo runbook cập nhật trước khi triển khai.
