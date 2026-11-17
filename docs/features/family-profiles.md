# Hồ sơ gia đình

## Sử dụng

Mở dashboard → **Gia đình**. Hồ sơ **Tôi** được nhập một lần từ cấu hình cục bộ, giữ topic hiện có; kiểm tra nội dung/địa điểm/giờ rồi đồng bộ. Phần **Cài đặt** và lịch trên máy vẫn dùng cho thao tác tạo bản tin local. Lịch gia đình chạy trên cloud, không cần PC bật sau khi đồng bộ.

1. Bấm **Thêm người**, đặt tên và chọn địa điểm. Bản đầu hỗ trợ Hà Nội, TP Hồ Chí Minh, Đà Nẵng, Hải Phòng, Cần Thơ và Huế.
2. Chọn thời tiết, AQI, Xăng E10 RON 95-III vùng 1, GitHub và các chủ đề RSS VnExpress. Mỗi thông báo có tối đa 3 tiêu đề RSS và 5 repo GitHub nếu bật. AQI là dự báo CAMS theo địa điểm, không phải số đo tại trạm; giá xăng vẫn là vùng 1 chứ không suy theo GPS.
3. Chọn giờ (cách nhau 30 phút) và ngày trong tuần, giờ Việt Nam. Hồ sơ mới mặc định tạm dừng và có topic ngẫu nhiên riêng.
4. Trên điện thoại người nhận, cài ntfy, thêm topic hiển thị trong hồ sơ với server `ntfy.sh`. Có nút sao chép topic. Không công khai topic.
5. Bật **Nhận bản tin**, bấm **Lưu & đồng bộ**, chờ trạng thái **Đã đồng bộ cloud**. Nếu chỉ lưu trên máy mà cloud lỗi, giao diện báo rõ; bấm **Đồng bộ lại** để thử lại. Cấu hình đã đồng bộ trước đó tiếp tục có hiệu lực cho tới khi đồng bộ thành công.
6. **Gửi thử riêng hồ sơ này** chỉ yêu cầu gửi cho người đang chọn; có thể cần vài phút. Gửi thử là một thông báo thật, có chủ đích gửi lại dù hôm nay đã nhận. Không bấm liên tục khi chưa rõ kết quả.

Tối đa 8 hồ sơ. Đây là ứng dụng do chủ máy quản lý tại loopback, chưa phải dịch vụ web có tài khoản độc lập cho từng người. Thành viên không cần truy cập dashboard; chỉ cần ntfy.

## Cloud và quyền riêng tư

- Workflow kiểm tra mỗi 30 phút. GitHub Actions có thể trễ; hồ sơ được gửi bù sau giờ hẹn trong cùng ngày, đúng ngày trong tuần, tối đa một lượt tự động/ngày. Không dùng như công cụ báo thức chính xác từng phút. Nếu một ngày không có lượt chạy thành công, không gửi bù sang ngày sau.
- PostgreSQL `family_configuration` lưu một tài liệu gia đình có revision. PUT dùng compare-and-swap, trả 409 nếu cửa sổ khác đã sửa. `synced_revision` phân biệt cấu hình đã lưu với cấu hình đã xác nhận trên cloud. Không giữ transaction SQL trong khi gọi GitHub.
- API mã hóa cấu hình bằng Libsodium sealed box với khóa công khai của GitHub, rồi cập nhật repository secret `HUB_FAMILY_JSON`. Tên, lịch cá nhân, topic không được commit trong repository công khai. Token quản trị chỉ ở backend, không trả về trình duyệt và không đưa vào ảnh Docker.
- Nhánh `hub-cloud-state` giữ dấu gửi theo ngày và hash ID hồ sơ, cùng dữ liệu công khai của GitHub/giá xăng. Không lưu tên/topic/cấu hình thành viên. Hồ sơ `personal` kế thừa ledger ngày cũ để tránh gửi trùng khi nâng cấp.
- Các GET nguồn giống nhau được dùng lại trong cùng lượt chạy; POST ntfy luôn tách theo người nhận. Một người gửi lỗi không chặn người khác; lần chạy lại vẫn tôn trọng reservation/sent/unknown để tránh trùng.
- Cloud dùng toàn bộ family secret nếu có; cấu hình gia đình sai phải báo lỗi, không âm thầm gửi cho người nhận legacy. Chưa đồng bộ family secret thì giữ chế độ cũ với lịch 7h đã cấu hình.
- Hồ sơ tạm dừng/xóa chỉ có hiệu lực trên cloud sau khi đồng bộ thành công; một lượt chạy đang thực thi có thể vẫn dùng cấu hình nó đã đọc.

## Thiết lập máy chủ quản lý

`node scripts/configure-family-cloud.mjs` dùng đăng nhập GitHub hiện có của Git Credential Manager để cấu hình `HUB_CLOUD_REPOSITORY` và `HUB_CLOUD_ADMIN_TOKEN` trong `.env` đã được gitignore. Cần quyền đọc public key, ghi Actions secrets và dispatch workflow cho repository này. Không gửi token qua chat hoặc nhập trong ô topic. Với cài đặt khác có thể tự cấp token giới hạn đúng repository/quyền trên và đặt hai biến ở môi trường API.

API Docker nhận hai biến quản trị riêng, worker/scheduler không nhận chúng. `HUB_ADMIN_ORIGIN` mặc định `http://127.0.0.1:8088`; nếu đổi địa chỉ dashboard, cấu hình origin tương ứng. Endpoint quản trị nhận JSON và từ chối Origin khác; đây không thay thế hệ thống đăng nhập nếu sau này mở dashboard ra Internet.

Migration `007_family.sql` chỉ thêm bảng mới, không sửa/xóa lịch sử. Trước khi khởi động API mới: `docker compose --env-file .env -f infra/compose.yaml run --rm --no-deps api pnpm --filter @hub/api migrate`. Giữ lịch local tắt khi dùng cloud.

Kiểm thử: `pnpm test`, `pnpm build`; DB integration `apps/api/src/family/family.integration.test.ts` dùng schema ngẫu nhiên trên `TEST_DATABASE_URL`. Các test kiểm tra lịch theo ngày, riêng người nhận, kế thừa ledger, retry sau kết quả gửi chưa rõ, mã hóa secret, conflict revision và trạng thái sync thất bại.

Thông báo tự rút gọn dưới 1.600 byte UTF-8 để dành chỗ cho các bản sao dữ liệu trong FCM/APNS. Khi cần, bỏ link phụ và rút ngắn mô tả trong push; dashboard local vẫn có nội dung/link đầy đủ. Vẫn giữ tối đa 3 tiêu đề RSS và 5 repo.
