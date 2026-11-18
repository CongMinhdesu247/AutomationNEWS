# Premium beta — đánh giá, kiến trúc và API

Ngày kiểm tra source: 15/11/2026. Ứng dụng đã public theo xác nhận của chủ dự án. Chưa kết nối HP; không suy luận trạng thái domain/tunnel hoặc RAM từ tài liệu cũ.

## Đánh giá trước thay đổi

Tái sử dụng React 19/Vite, Fastify 5, TypeScript, pnpm 11, Zod, pg/PostgreSQL 17, SQL migrations có checksum, session cookie, cấu hình/lịch từng user, RSS parser, safeHttp, queue DAG với lease/heartbeat/recovery, scheduled_deliveries và ntfy. Không thay ORM/framework/auth, không thêm dịch vụ hoặc dependency runtime.

Cần sửa: queue nhận workflow nội bộ premium.v1; executor nhận node premium_task; scheduler hiện có nhận thêm tickCustom; bước persist_digest đính kèm kết quả; frontend thêm hai trang trong layout hiện tại. digest.v1 và các lịch cũ giữ nguyên. Không nhập RSS cá nhân vào cache công khai.

Cần thêm: gói/quyền độc lập role, quản trị beta có audit, nhu cầu xác nhận, nguồn duyệt thủ công, tin công khai dùng chung, kết quả riêng tư, ledger và budget reservation, adapter Gemini/disabled/fake, retention và kiểm thử.

Rủi ro: migration cần chạy trước code mới; backup/restore cần thực hiện trước cập nhật HP; code cũ không hiểu premium.v1 nên rollback phải kết thúc riêng các tác vụ mới trước khi khởi động worker cũ. Không sửa migration 001–010. Các thay đổi giao diện đã có trước tác vụ được giữ lại; gói source sẽ chứa cả các thay đổi chưa commit đó, phải review release diff.

Thứ tự: schema bổ sung → gói/quyền → theo dõi RSS không AI → hiểu yêu cầu/enrichment có budget → kiểm thử/restore/UI → chuẩn bị release. Khám phá nguồn triển khai riêng sau phần reservation: adapter Brave một truy vấn/tác vụ, vẫn mặc định tắt; chưa gọi search thật hoặc phát hành lên HP.

## Schema 011–012

ID người dùng/run/nhu cầu/nguồn/tin tiếp tục là UUID. Audit dùng bigint identity. FK, UNIQUE và index nằm trong migration.

| Nhóm | Bảng |
| --- | --- |
| Gói | news_plans, news_entitlements; trigger gán Free cho tài khoản mới, backfill tài khoản cũ |
| Audit | news_audit; before/after cấp gói, thay hạn mức, điều khiển AI, duyệt nguồn |
| Nhu cầu | news_watches, news_watch_sources; điều kiện JSON đã Zod validate, version, trạng thái và thời điểm kiểm tra |
| Nguồn công khai | news_sources; pending/approved/rejected, lease cache, lỗi fetch |
| Nội dung công khai | news_articles, news_source_articles, news_enrichment, news_discovery_cache |
| Dữ liệu riêng | news_matches, news_preferences, news_digest_items |
| Tác vụ | news_tasks liên kết workflow_runs hiện có, không có queue thứ hai |
| Chi phí | news_ai_control, news_usage; ledger đồng thời là reservation, tách reserved_search_units |

Role chỉ admin/member. Admin mặc định Free như mọi tài khoản và không được miễn hạn mức. Free không làm thay đổi settings, days, next_run_at, cấu hình ntfy, giới hạn bản tin hiện có hoặc lịch sử.

Premium hết hạn/thu hồi: đọc nhu cầu và kết quả vẫn được; tạm dừng/xóa vẫn được; tạo/sửa/kích hoạt và worker bị chặn. Không xóa dữ liệu vì hết hạn. Cờ enabled được giữ: gia hạn sẽ cho scheduler tiếp tục nếu người dùng chưa tạm dừng; có thể tạm dừng trước gia hạn để tự chọn lúc bật lại.

## Luồng dữ liệu

1. User nhập form hoặc gửi description để nhận job AI 202. AI chỉ trả đề xuất, không tự lưu nhu cầu.
2. User kiểm tra preview và xác nhận. API whitelist trường, lấy chủ sở hữu từ session; `confirmed:true` là hợp đồng xác nhận, không phải cơ chế bảo mật.
3. Scheduler chọn tối đa một nhu cầu đến hạn/tick, đẩy vào queue hiện có, tính lần sau từ hiện tại, không replay khoảng thời gian bị bỏ lỡ. User disabled/entitlement hết hạn không được chọn.
4. Worker kiểm tra lại chủ sở hữu, gói, số nhu cầu, phiên bản và trạng thái. Nguồn approved dùng cache 15 phút với lease DB 40 giây. Fetch không giữ transaction; worker khác đợi cache đang fetch trong giới hạn thời gian.
5. RSS dùng lại connector hiện có: tối đa 2 MiB phản hồi, 3 redirects kiểm tra DNS/IP ở từng bước, pin IP khi kết nối, tối đa 10 mục nguồn trong 24 giờ, excerpt tối đa 400 ký tự. Không đọc trang bài viết/nhóm kín, không vượt login/CAPTCHA.
6. Deterministic matching: tất cả include, không exclude; OR trong nhóm regions/types. Không tự suy diễn châu lục hoặc đồng nghĩa; cần ghi các từ có trong nguồn. Deadline chỉ nhận đoạn có nhãn deadline/closing date/hạn chót/hạn đăng ký/hạn nộp và ngày ISO. Không bảo đảm xác định hạn chính xác; user phải kiểm tra tại nguồn.
7. Tin dedupe theo URL đã bỏ tracking; lưu hash nội dung và liên kết nguồn. Kết quả `(watch,article)` riêng theo user, ghi lý do và phiên bản. Sửa nhu cầu tăng version, hủy hiệu lực job cũ, tìm lại cửa sổ 1–30 ngày trên cache có sẵn; không backfill Internet 30 ngày.
8. persist_digest chọn tối đa 10 tin mới trong 7 ngày, gom theo article giữa nhiều nhu cầu cho cùng user. Chỉ đính kèm khi Premium còn hạn và includeDigest bật. Unique `(user,article)` ngăn đưa lại sau sửa nhu cầu. Savepoint giúp lỗi phần custom không làm mất bản tin thường.
9. Section custom đi qua formatter/ntfy và lịch/timezone/topic hiện tại. Không topic mới, không thay lịch. Bản tin đã lưu giữ snapshot custom sau hết hạn.

Đánh dấu đã đưa vào bản tin **không đồng nghĩa đã đến điện thoại**. Nếu tắt thông báo hoặc gửi timeout, tin vẫn ở website; không tự đưa lại trong bản tin kế tiếp. Existing notification_attempts/scheduled_deliveries giữ trạng thái unknown khi gián đoạn; không hứa exactly-once.

Kết quả cũ của phiên bản trước được giữ như lịch sử và ghi condition_version; màn hình đang hiển thị cả lịch sử. Hủy/ẩn chúng nếu không muốn xuất hiện trong bản tin. Nguồn không có kết quả không phải bằng chứng không tồn tại cơ hội phù hợp.

## API

Mọi `/api/account/*` dưới đây yêu cầu session, kiểm tra user tại route và worker. Mọi admin endpoint có guard admin riêng, kể cả khi tools chạy auth disabled. Mutations vẫn chịu kiểm tra Origin hiện tại.

| Method/path | Hành vi |
| --- | --- |
| GET /api/account/plan | Gói hiệu lực, hạn, hạn mức, usage tháng UTC, công tắc |
| PUT /api/account/custom-preferences | `{includeDigest:boolean}` |
| GET /api/account/custom-sources | Chỉ nguồn approved công khai |
| POST /api/account/custom-sources | `{name,url}`, kiểm tra URL/DNS, 202 pending; không fetch trong request |
| GET/POST /api/account/watches | Danh sách / tạo nhu cầu đã xác nhận |
| PUT /api/account/watches/:id | Sửa toàn bộ, tăng version |
| PATCH /api/account/watches/:id | `{enabled:false}`, cho phép khi hết hạn |
| DELETE /api/account/watches/:id | Soft delete, không xóa tin công khai |
| GET /api/account/custom-results?page=1 | 50 kết quả/trang, riêng user |
| PATCH /api/account/custom-results/:watchId/:articleId | `{saved,hidden}` |
| POST /api/account/custom-interpret | `{description}`, UUID Idempotency-Key; 202 runId/statusUrl |
| POST /api/account/custom-enrich/:articleId | Chỉ tin đã khớp user; cache public hash+processing version hoặc 202; UUID key |
| POST /api/account/custom-discover | `{description}` tối đa 300 ký tự, một truy vấn; cache 200 hoặc job 202, UUID key |
| GET /api/account/custom-jobs/:id | Trạng thái và đề xuất riêng user |
| GET /api/admin/premium | User, gói, audit |
| PUT /api/admin/premium/:userId | `{plan,expiresAt,reason}`; grant/renew/revoke atomic với audit |
| PUT /api/admin/plans/:id | Hạn mức tập trung, không thay quyền Free cũ |
| GET/PUT /api/admin/custom-ai | Điều khiển/budget; usage và jobs lỗi, không chứa key |
| PUT /api/admin/custom-sources/:id | Duyệt/từ chối, kiểm tra URL/DNS lại |

Payload nhu cầu: name, description, conditions `{include,exclude,regions,opportunityTypes,deadlineAfter}`, sourceIds, intervalMinutes, enabled, lookbackDays, confirmed. Strict schema chặn userId/role/plan/quota thêm vào. AI output cũng strict schema trước lưu.

## Ngân sách và giới hạn vận hành

Mặc định DB AI=false, search=false, budget/call/token=0; Compose FREE_ONLY=true. Không bật provider chỉ bằng cách thêm key. Quyền Premium vẫn không tự bật AI.

Reservation: một transaction ngắn với advisory lock toàn hệ thống + row lock control; kiểm tra gói/quota/tháng UTC, ngân sách ngày/tháng UTC, calls/ngày, tokens/tháng, search units/ngày/tháng và concurrency. Sau commit mới gọi mạng. Mỗi run chỉ được một reservation; retry/recovery không gọi provider nếu có reservation trước đó. Giới hạn input 12.000 byte, reserve 16.000 input + 1.024 output (18.000 token quota bảo thủ), timeout tối đa 30 giây, Gemini không tool/search/candidate phụ; khám phá nguồn dùng request tìm kiếm riêng, không gọi LLM. Không tự retry lỗi provider/timeout/schema.

Usage thiếu hoặc call bị ngắt là unknown, giữ full reserved_micros và reserved_tokens; không mặc định 0. Chỉ completed có usage hợp lệ mới giảm reservation về chi phí ước tính. Dùng số nguyên micro USD, snapshot giá và pricingVersion. Đây là ước tính theo giá admin đã xác minh, **không phải bảo đảm trần hóa đơn của tài khoản Google**; key không dùng chung cho ứng dụng khác, cần quota/hạn mức tại provider và đối soát billing. Không thêm FREE_ONLY dựa trên bộ đếm local: bản này FREE_ONLY tắt mọi provider, vẫn dùng RSS trực tiếp.

Một enrichment dùng chung theo content hash và phiên bản gồm model/pricing. API kiểm tra quyền đọc tin trước tra cache. Enrichment là API tùy chọn; chưa tự động dùng kết quả AI để suy diễn mọi trường khi deterministic không khớp. AI không có tool thực thi, nội dung nguồn không phải lệnh; evidence phải là đoạn có thật trong input.

Concurrency dùng worker hiện tại (mặc định 3), AI riêng mặc định 1, tối đa 3. Một job watch fetch tuần tự, giới hạn toàn job 35 giây/8 nguồn. Nguồn lỗi không ảnh hưởng digest.v1. Chưa có bảo đảm phân bổ công bằng giữa user khi backlog rất lớn; đo queue latency trước mở rộng số tài khoản.

Retention: `pnpm retention --premium` chỉ dry-run; thêm `--apply` để redact payload/result AI terminal và excerpt/enrichment sau 30 ngày, tối đa 500 dòng mỗi nhóm/lần; `--content-days=... --batch=...` điều chỉnh. Usage completed giữ ít nhất 400 ngày; unknown giữ để đối soát. Kết quả chưa lưu giữ mặc định 365 ngày (`--result-days`, tối thiểu 90); tin công khai không còn được tham chiếu dọn sau 90 ngày; cache tìm nguồn hết hạn 24 giờ. Không xóa tài khoản, lịch, bản tin, nhu cầu, kết quả saved hoặc audit. Hết hạn Premium không kích hoạt retention. Lập lịch bảo trì thủ công theo runbook; mặc định không âm thầm xóa dữ liệu production.

## Gemini: bằng chứng tài liệu, không phải live test

Tra ngày 15/11/2026: [model Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [GenerateContent REST/usage](https://ai.google.dev/api/generate-content), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [thinking](https://ai.google.dev/gemini-api/docs/thinking). Adapter hỗ trợ REST JSON và schema, giới hạn output, không built-in tools. Gemini 3.5 Flash-Lite hỗ trợ structured outputs và minimal thinking. Gemini 2.5 Flash đang deprecated; không lấy ví dụ test fixture làm model production mặc định.

[Bảng giá](https://ai.google.dev/gemini-api/docs/pricing): tại thời điểm tra, Gemini 3.5 Flash-Lite Standard text là $0.30 input và $2.50 output/triệu token. Google Search có cách tính phí riêng. Giá/quota/model có thể thay đổi; xác minh lại ngay trước bật, không hứa miễn phí vĩnh viễn. [Quota](https://ai.google.dev/gemini-api/docs/rate-limits) áp dụng theo project, có nhiều chiều giới hạn; bộ đếm app dùng chu kỳ UTC riêng.

[Điều khoản](https://ai.google.dev/gemini-api/terms) và chính sách dữ liệu cần chủ dự án kiểm tra theo người dùng/khu vực thực tế trước bật API public. Free/Paid có cách xử lý dữ liệu khác nhau. Không gửi nội dung nhạy cảm; UI phải thông báo người dùng rằng description chuyển tới provider khi bấm trợ lý. Chưa có tài khoản provider/billing production nào được kiểm tra, chưa gọi model thật.

## Các khoảng trống công khai còn lại

- Built-in Google Search của Gemini không dùng. Adapter tìm nguồn riêng đã có fake/disabled/Brave; chưa gọi Brave thật, chưa xác minh tài khoản/gói được phép lưu kết quả hoặc billing production. Cần bật có chủ đích sau kiểm tra này, không quảng cáo search miễn phí.
- Chỉ RSS/Atom đã duyệt cho custom ở bản này. Các API connector cũ vẫn phục vụ bản tin thường; chưa có connector cơ hội học bổng/API tùy ý.
- Chưa email verification và reset qua email; đã có owner CLI hỗ trợ reset và rate limits hiện tại. Hoàn thiện xác minh email, reset token một lần có hạn, throttling và thử SMTP trước mở đăng ký rộng. Không dùng email chưa xác minh như bằng chứng chủ sở hữu.
- Topic ntfy public không là ACL. Thành viên không đổi destination, safeHttp chống SSRF; API và scheduler production giới hạn destination trong ACCOUNT_NTFY_URL và NTFY_ALLOWED_ORIGINS; các origin LAN cho phép vẫn chịu kiểm tra metadata/link-local. Các fixture/tool có HTTP injection không mặc định bật allowlist destination production. Với token ntfy dùng chung, kiểm tra destination cũ và allowlist trước release; cần ntfy có auth/ACL nếu muốn riêng tư thực sự.
- Chưa đo tải thực tế trên máy chủ đích, load nhiều tài khoản hoặc thời gian vận hành dài. Không dự báo uptime/capacity từ fixture PC.


## Khám phá nguồn có giới hạn (migration 012)

SearchAdapter tách Gemini: disabled/fake/Brave Web Search. Mỗi tác vụ đúng một HTTP request, count=5, không pagination, không retry, không browser hoặc follow-up agent. Giá search/phiên bản giá, quota discovery theo user và search units/ngày/tháng riêng; tổng ngân sách tiền ngày/tháng dùng chung ledger với AI. Một request reserve một search unit, không reserve token; lỗi/timeout giữ nguyên reservation và unknown. Công tắc NEWS_SEARCH_KILL_SWITCH độc lập NEWS_AI_KILL_SWITCH; FREE_ONLY chặn cả hai.

Query tối đa 300 ký tự, do user xác nhận bấm gửi; cache theo hash query chuẩn hóa + provider/pricing version, không lưu query thô trong cache chung. Chỉ ứng viên URL/snippet công khai được chia sẻ, job/payload/quota riêng từng user. Một query đang chạy dùng chung admission lock; user khác nhận pending hoặc cache, không xem job riêng của người khác. Cache hit không tạo provider call hoặc usage mới. Cache hiệu lực 24 giờ, có retention. DNS/IP validation từng ứng viên loại loopback/private/mixed DNS, không fetch trang ứng viên. User chọn URL để đề nghị; nguồn vào pending và admin kiểm tra RSS/điều khoản trước approved. Fetch định kỳ tiếp tục recheck DNS/IP ở mọi redirect, không tin kết quả search làm allowlist.

[Tài liệu Brave Web Search](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started) xác định endpoint/header. [Bảng giá Brave](https://api-dashboard.search.brave.com/app/plans) tại ngày tra 15/11/2026 liệt kê Search $5/1.000 requests, credit/điều khoản thay đổi theo gói; cấu hình không suy đoán credit miễn phí. [Điều khoản lưu kết quả](https://api-dashboard.search.brave.com/documentation/resources/terms-of-service) và [hướng dẫn quyền lưu](https://api-dashboard.search.brave.com/documentation/resources/help-feedback) yêu cầu quyền phù hợp khi lưu/cache kết quả. searchStorageAllowed mặc định false; admin chỉ bật sau xác minh gói cho phép lưu, ghi vào audit. Giá của gói có quyền lưu có thể khác giá niêm yết; phải nhập giá thực của tài khoản. Không gửi kết quả Brave vào Gemini; dữ liệu RSS trích xuất có nguồn và quyền sử dụng riêng. Snippet chỉ là bằng chứng công cụ trả về, không bảo đảm URL là feed hay thông tin còn đúng.


## Đăng ký Premium và giao diện đơn giản — thay đổi local 16/11/2026

Migration 013 thêm news_plan_requests, một yêu cầu hiện tại cho mỗi user, có trạng thái pending/approved/declined, thời gian và người duyệt. Không sửa 001–012. GET /api/account/plan bổ sung signup riêng user và premiumOffer từ hạn mức server. POST /api/account/premium-request nhận note tối đa 500 ký tự, trả 202, chống gửi trùng bằng transaction/lock user; không đổi role/entitlement. Sau khi bị từ chối, gửi lại tối thiểu 24 giờ từ lần đăng ký trước.

Người dùng Free vào Gói & theo dõi → Gói của tôi → Đăng ký Premium thử nghiệm. Tiếp tục dùng Free khi chờ. Admin vào Premium & AI → Đăng ký đang chờ duyệt, cấp 30 ngày hoặc chưa nhận đợt này. Cấp gói qua endpoint admin hiện có đồng thời đánh dấu approved; từ chối qua POST /api/admin/premium-requests/:userId/decline có lý do. Cả hai được audit, session/user thường không tự nâng quyền. Chưa thanh toán tự động.

Trang user tách Theo dõi của tôi / Kết quả / Gói của tôi. Form tạo có hai bước, phần nâng cao và công cụ nguồn thu gọn; lý do khớp và trích xuất mở khi cần. Không bỏ các điều kiện, lựa chọn nguồn, xác nhận hoặc hạn mức server. Local fixture có thể dùng PREMIUM_BROWSER_SCHEMA để giữ lại dữ liệu qua lần reload API, chỉ chấp nhận schema premium_browser_ với 32 ký tự hex trong accounts_test.

Các gói source/image đã chuyển lên HP trước thay đổi này chưa chứa migration 013 hoặc giao diện mới. Phải đóng gói lại và chuyển lại trước khi cập nhật production; trong lúc người dùng đang review localhost, chưa triển khai HP.
