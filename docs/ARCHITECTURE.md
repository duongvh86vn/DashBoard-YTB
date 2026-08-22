# Kiến trúc Phase 2

Tài liệu này mô tả foundation đang được xây dựng theo
`YOUTUBE_HOME_MONITOR_AI_SPEC.md` và `IMPLEMENTATION_PLAN.md`. Nó không phải bằng
chứng rằng Phase 0 đã vượt quality gate; kết quả chạy thực tế phải được ghi riêng.

## Phạm vi

Phase 2 giữ toàn bộ foundation/auth của Phase 1 và thêm canonical channel
resolution, RSS discovery, metadata-only yt-dlp/public-page fallback,
Channel/ChannelSnapshot/ChannelDailyStat/SyncRun persistence, daily delta
derivation và add-channel UI tiếng Việt. Video discovery, Playwright health và
deletion safety, monitoring rankings, Gemini/NVIDIA và deployment LAN/public
vẫn thuộc các phase sau.

```text
Host 127.0.0.1:WEB_PORT
          |
          v
        Web -------------- frontend network -------------- API
                                                              |
                                                        database network
                                                              |
                                      +-----------------------+----------------+
                                      |                       |                |
                                   Worker                 db-migrate       PostgreSQL
                                      |
                               egress-only network
```

Startup order là PostgreSQL healthy rồi `db-migrate` kết thúc với exit code 0.
Sau đó Worker và API có thể khởi động độc lập; Web chờ API đạt DB-readiness.
Worker không được chặn API/Web: khi Worker hỏng hoặc stale, user-facing
services vẫn phục vụ và ADMIN health phản ánh đúng HTTP 503.

## Ranh giới dịch vụ

- **Web** là Next.js UI tiếng Việt cho login, dashboard shell và users. Không có
  anonymous HTTP health route. Rewrite `/api/v1/:path*` chuyển request cùng
  origin đến API; Web không kết nối trực tiếp PostgreSQL hoặc Worker.
- **API** là NestJS REST service với prefix `/api/v1`. API sở hữu auth/session,
  user authorization và dependency health aggregation, nhưng không có host port.
- **Worker** là NestJS application context không gọi `listen()` và không mở port.
  Worker ghi heartbeat định kỳ, dừng timer và ngắt Prisma khi shutdown.
- **PostgreSQL** là nguồn sự thật phía server cho users, sessions, throttle,
  audit logs và worker heartbeats. Prisma migration được chạy bởi service
  one-shot **db-migrate**; **db-seed** chỉ chạy trong profile seed.

Package boundaries chính:

```text
web    -> shared, config
api    -> shared, config, db, collectors/ytdlp, collectors/youtube-public
worker -> shared, config, db, collectors/ytdlp, collectors/youtube-rss
db     -> Prisma client + PostgreSQL adapter
collectors -> shared (không truy cập database trực tiếp)
```

Collector chỉ trả về canonical/nullable provider contracts; AI không được import
vào raw-data path và không phải nguồn dữ liệu.

## Heartbeat

Mỗi worker có một row khóa bởi `worker_id`, gồm `version`, `last_seen_at` và
`status`. Upsert dùng `CURRENT_TIMESTAMP` của PostgreSQL và idempotent theo
`worker_id`.

- Worker ghi ngay khi khởi động, sau đó mặc định mỗi 15 giây.
- Container healthcheck đọc heartbeat của **chính `WORKER_ID` đó**; heartbeat mới
  của worker khác không được che một worker đã stale.
- Mặc định heartbeat cũ hơn 45 giây là unavailable.
- API system-level health có thể dùng heartbeat RUNNING mới nhất để cho biết có
  worker phục vụ hệ thống hay không.
- PostgreSQL connect/statement/query và API dependency reads đều có deadline nhỏ
  hơn container health budget. Worker chờ in-flight heartbeat tối đa hữu hạn khi
  shutdown; timeout ứng dụng không giả vờ hủy Promise tùy ý, còn PostgreSQL thật
  được chặn thêm ở driver/server.

## Auth và health contract

Response dùng schema chung với status:

```text
ok | degraded | unavailable | disabled
```

- Required dependency `unavailable` làm response aggregate thành `unavailable`
  và trả HTTP 503.
- Optional dependency unavailable làm aggregate `degraded`; HTTP vẫn là 200.
- Component có toàn bộ check chưa bật trả `disabled`; HTTP 200.
- Mọi `/api/v1/health*` yêu cầu authenticated ADMIN; anonymous nhận 401 và
  VIEWER nhận 403. Aggregate `/api/v1/health` yêu cầu DB và Worker.
  Collector/AI là optional và `disabled` trong Phase 1, nên không làm aggregate
  thất bại.
- Mọi health response dùng `Cache-Control: no-store` và không lộ exception text,
  SQL, connection string, secret hoặc filesystem path.
- Container readiness của API dùng endpoint DB chuyên biệt, không dùng aggregate,
  để Worker unavailable không biến thành startup dependency vòng ngoài ý muốn.

Các endpoint Phase 1:

```text
GET /api/v1/health
GET /api/v1/health/db
GET /api/v1/health/worker
GET /api/v1/health/collectors
GET /api/v1/health/ai
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET /api/v1/auth/me
POST /api/v1/auth/change-password
GET|POST /api/v1/users
PATCH /api/v1/users/:id
POST /api/v1/users/:id/reset-password
POST /api/v1/users/:id/revoke-sessions
POST /api/v1/users/:id/disable
POST /api/v1/users/:id/enable
DELETE /api/v1/users/:id
```

Các endpoint Phase 2:

```text
GET /api/v1/channels?page=1&pageSize=20
GET /api/v1/channels/:id
POST /api/v1/channels                 (ADMIN, canonical resolution bắt buộc)
DELETE /api/v1/channels/:id           (ADMIN, archive alias)
```

Session là opaque token trong HttpOnly SameSite=Lax cookie; PostgreSQL chỉ lưu
keyed token hash. LOCAL dùng host-only cookie không `Secure`; PUBLIC cookie
contract được giữ cho phase HTTPS sau này. `DELETE /users/:id` là disable alias,
không hard-delete. Không có signup/OAuth.

## Same-origin và cô lập mạng

Compose dùng ba network tách biệt:

- `frontend`: bridge network của Web và API; network này cho phép port loopback
  của Web thực sự được publish trên Docker Desktop.
- `database`: internal network của API, Worker, db-migrate và PostgreSQL.
- `egress`: bridge network chỉ dành cho Worker gọi public provider/collector ở
  các phase sau; không service nào publish port qua network này.

Web và PostgreSQL không chia sẻ network. API là service duy nhất nối cả hai
frontend/database network; Worker nối database + egress nhưng không nối frontend.
Chỉ Web publish `127.0.0.1:${WEB_PORT:-3000}:3000`; PostgreSQL, API và Worker
không publish host port. Vì vậy Phase 1 chỉ truy cập từ máy host, chưa phải
LAN/public deployment. Docker readiness dùng bounded TCP probe bên trong API/Web;
không dùng HTTP liveness công khai.

Compose bắt buộc `POSTGRES_PASSWORD` và `DATABASE_URL`; không có fallback password
được dùng để boot manual stack. Các giá trị thật không được commit hoặc ghi log.
Logging áp dụng redaction đệ quy cho key/secret/token/password ở mọi độ sâu, scrub
credential trong URL và chỉ serialize một allowlist metadata an toàn từ `Error`.

Phase 9 mới thêm Caddy, LAN port và Cloudflare Tunnel để giữ cùng origin ngoài
production:

```text
/api/v1/* -> API
/*        -> Web
```

## Invariants

- Server/PostgreSQL là source of truth; scheduled writes phải idempotent.
- `AI != DATA SOURCE`; AI optional và chưa chạy ở Phase 0.
- `VIDIQ BASIC != BACKEND API`; không có MCP, OAuth hoặc private YouTube path.
- Missing data giữ `NULL`; không backfill lịch sử giả.
- PostgreSQL và Worker không public; secret luôn được validate/redact.
- Các invariant tương lai vẫn giữ nguyên: canonical Channel ID, no false delete,
  Top Week bằng rolling 7-day gain, Hot Now bằng local velocity và Breakout bằng
  same-channel baseline.

## Phần được hoãn

- Phase 2: channel resolution, RSS, yt-dlp, snapshots và daily history (đã có).
- Phase 3: Playwright public health và deletion safety.
- Phase 4–5: video monitoring và deterministic rankings.
- Phase 6–7: Gemini, NVIDIA, schema validation, cache và fallback router.
- Phase 8: dashboard tiếng Việt hoàn chỉnh.
- Phase 9: Caddy, LAN, Cloudflare Tunnel và public-security smoke tests.
- Phase 10: backup/restore, retention, performance và host-reboot verification.
