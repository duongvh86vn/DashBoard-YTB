# Kiến trúc hiện hành (Phase 0–11)

Tài liệu này mô tả kiến trúc đã triển khai theo
`YOUTUBE_HOME_MONITOR_AI_SPEC.md` và `IMPLEMENTATION_PLAN.md`. Bằng chứng chạy
thực tế vẫn được ghi riêng trong `WORKLOG.md`.

## Phạm vi

Hệ thống gồm auth/session, dashboard tiếng Việt, canonical channel
resolution, RSS/public metadata collectors, channel/video snapshots, daily
history, health/deletion safety, deterministic rankings, Gemini/NVIDIA AI tùy
chọn, sync history, settings và Docker/LAN hosting. Phase 11 thêm nhóm kênh,
phạm vi VIEWER nhiều-nhóm do server cưỡng chế, và observed partial
metrics mà không làm yếu quy tắc missing=`NULL`.

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

- **Web** là Next.js UI tiếng Việt cho login, dashboard, users, groups,
  channels, health, videos/rankings, sync và settings. Không có anonymous HTTP
  health route. Rewrite `/api/v1/:path*` chuyển request cùng origin đến API;
  Web không kết nối trực tiếp PostgreSQL hoặc Worker.
- **API** là NestJS REST service với prefix `/api/v1`. API sở hữu auth/session,
  user authorization và dependency health aggregation, nhưng không có host port.
- **Worker** là NestJS application context không gọi `listen()` và không mở port.
  Worker ghi heartbeat định kỳ, dừng timer và ngắt Prisma khi shutdown.
- **PostgreSQL** là nguồn sự thật phía server cho users, sessions, throttle,
  audit logs, groups/memberships, canonical metrics, AI reports và worker
  heartbeats. Prisma migration được chạy bởi service one-shot
  **db-migrate**; **db-seed** chỉ chạy trong profile seed.

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
  Collector/AI là optional/configurable; `disabled` hoặc unavailable chỉ làm
  aggregate `degraded`, không biến AI thành startup dependency bắt buộc.
- Mọi health response dùng `Cache-Control: no-store` và không lộ exception text,
  SQL, connection string, secret hoặc filesystem path.
- Container readiness của API dùng endpoint DB chuyên biệt, không dùng aggregate,
  để Worker unavailable không biến thành startup dependency vòng ngoài ý muốn.

Các endpoint core (rút gọn):

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

Các endpoint channel và group:

```text
GET /api/v1/channels?page=1&pageSize=20
GET /api/v1/channels/:id
POST /api/v1/channels                 (ADMIN, canonical resolution bắt buộc)
DELETE /api/v1/channels/:id           (ADMIN, archive alias)
GET /api/v1/channel-groups/accessible (ADMIN hoặc VIEWER, đã scope)
GET|POST /api/v1/channel-groups       (ADMIN)
GET|PATCH|DELETE /api/v1/channel-groups/:id (ADMIN)
PUT /api/v1/channel-groups/:id/channels     (ADMIN, atomic full replacement)
PUT /api/v1/users/:id/channel-groups        (ADMIN, atomic full replacement)
```

Session là opaque token trong HttpOnly SameSite=Lax cookie; PostgreSQL chỉ lưu
keyed token hash. LOCAL dùng host-only cookie không `Secure`; PUBLIC dùng
`__Host-yhm_session` với `Secure` và chỉ được bật cùng HTTPS/trusted proxy.
`DELETE /users/:id` là disable alias,
không hard-delete. Không có signup/OAuth.

ADMIN có phạm vi kênh không giới hạn. VIEWER nhìn thấy union có dedup của
các kênh trong những group đang hoạt động được gán cho họ; không có
group nghĩa là zero channel. API/service/repository cùng áp dụng scope cho
list, aggregate và direct ID; tài nguyên ngoài scope trả not-found. Sync-run
inspection và global AI reports vẫn ADMIN-only cho đến khi artifact có
group-scoped fingerprint.

## Same-origin và cô lập mạng

Compose dùng ba network tách biệt:

- `frontend`: bridge network của Web và API; network này cho phép port loopback
  của Web thực sự được publish trên Docker Desktop.
- `database`: internal network của API, Worker, db-migrate và PostgreSQL.
- `egress`: bridge network chỉ dành cho Worker gọi public provider/collector ở
  các phase sau; không service nào publish port qua network này.

Web và PostgreSQL không chia sẻ network. API là service duy nhất nối cả hai
frontend/database network; Worker nối database + egress nhưng không nối frontend.
Profile mặc định chỉ publish Web trên `127.0.0.1:${WEB_PORT:-3000}:3000`;
PostgreSQL, API và Worker không publish host port. Profile Caddy chỉ publish
proxy port đã chọn. Docker readiness dùng bounded TCP probe bên trong API/Web;
không dùng HTTP liveness công khai.

Compose bắt buộc `POSTGRES_PASSWORD` và `DATABASE_URL`; không có fallback password
được dùng để boot manual stack. Các giá trị thật không được commit hoặc ghi log.
Logging áp dụng redaction đệ quy cho key/secret/token/password ở mọi độ sâu, scrub
credential trong URL và chỉ serialize một allowlist metadata an toàn từ `Error`.

Phase 9 bổ sung profile Caddy (LAN bind tùy chọn) để giữ cùng origin ngoài
production; Cloudflare Tunnel vẫn là external owner-managed state:

```text
/api/v1/* -> API
/*        -> Web
```

## Invariants

- Server/PostgreSQL là source of truth; scheduled writes phải idempotent.
- `AI != DATA SOURCE`; AI optional, chỉ giải thích evidence cục bộ và không
  được ghi đè canonical metrics.
- `VIDIQ BASIC != BACKEND API`; không có MCP, OAuth hoặc private YouTube path.
- Missing data giữ `NULL`; không backfill lịch sử giả. Strict timeline
  totals chỉ có khi coverage complete; observed partial luôn kèm covered/total.
  `0* · chưa xác minh` chỉ là UI fallback, không phải canonical zero.
- PostgreSQL và Worker không public; secret luôn được validate/redact.
- Các invariant xếp hạng vẫn giữ nguyên: canonical Channel ID, no false delete,
  Top Week bằng rolling 7-day gain, Hot Now bằng local velocity và Breakout bằng
  same-channel baseline.

## External operator checks còn phụ thuộc môi trường

- Public HTTPS/Cloudflare Tunnel smoke cần domain và credential do owner quản lý.
- Host reboot và backup/restore production phải được owner chạy trên máy
  đích; isolated Docker acceptance không thay thế cho kiểm tra này.
- Live YouTube upstream smoke có thể bị rate-limit và không phải điều kiện
  để isolated test gate đạt.
