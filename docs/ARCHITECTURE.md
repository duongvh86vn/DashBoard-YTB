# Kiến trúc Phase 0

Tài liệu này mô tả foundation đang được xây dựng theo
`YOUTUBE_HOME_MONITOR_AI_SPEC.md` và `IMPLEMENTATION_PLAN.md`. Nó không phải bằng
chứng rằng Phase 0 đã vượt quality gate; kết quả chạy thực tế phải được ghi riêng.

## Phạm vi

Phase 0 chỉ dựng Web, API, Worker, PostgreSQL, migration, health contract và
logging/config nền tảng. Chưa có collector YouTube, dữ liệu channel/video, auth,
dashboard hoàn chỉnh hoặc lời gọi Gemini/NVIDIA.

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
Sau đó Worker và API có thể khởi động độc lập; Web chờ API đạt DB-readiness. Worker
không được chặn API/Web: khi Worker hỏng hoặc stale, user-facing services vẫn
phục vụ và aggregate health phản ánh đúng HTTP 503.

## Ranh giới dịch vụ

- **Web** là Next.js UI tiếng Việt tối thiểu. `GET /health` chỉ phản ánh process
  Web. Rewrite `/api/v1/:path*` chuyển request cùng origin đến API; Web không kết
  nối trực tiếp PostgreSQL hoặc Worker.
- **API** là NestJS REST service với prefix `/api/v1`. API sở hữu dependency
  health aggregation, đọc PostgreSQL và heartbeat của worker, nhưng không có host
  port trong Phase 0.
- **Worker** là NestJS application context không gọi `listen()` và không mở port.
  Worker ghi heartbeat định kỳ, dừng timer và ngắt Prisma khi shutdown.
- **PostgreSQL** là nguồn sự thật phía server. Model ứng dụng duy nhất của Phase 0
  là `worker_heartbeats`; Prisma migration được chạy bởi service one-shot
  **db-migrate**.

Package boundaries chính:

```text
web    -> shared, config
api    -> shared, config, db
worker -> shared, config, db
db     -> Prisma client + PostgreSQL adapter
```

Collector và AI không được import vào raw-data path ở Phase 0.

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

## Health contract

Response dùng schema chung với status:

```text
ok | degraded | unavailable | disabled
```

- Required dependency `unavailable` làm response aggregate thành `unavailable`
  và trả HTTP 503.
- Optional dependency unavailable làm aggregate `degraded`; HTTP vẫn là 200.
- Component có toàn bộ check chưa bật trả `disabled`; HTTP 200.
- Aggregate `/api/v1/health` yêu cầu DB và Worker. Collector/AI là optional và
  `disabled` trong Phase 0, nên không làm aggregate thất bại.
- `/api/v1/health/collectors` và `/api/v1/health/ai` trả top-level `disabled`,
  không giả báo `ok`.
- Mọi health response dùng `Cache-Control: no-store` và không lộ exception text,
  SQL, connection string, secret hoặc filesystem path.
- Container readiness của API dùng endpoint DB chuyên biệt, không dùng aggregate,
  để Worker unavailable không biến thành startup dependency vòng ngoài ý muốn.

Các endpoint Phase 0:

```text
GET /health
GET /api/v1/health
GET /api/v1/health/db
GET /api/v1/health/worker
GET /api/v1/health/collectors
GET /api/v1/health/ai
```

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
không publish host port. Vì vậy Phase 0 chỉ truy cập từ máy host, chưa phải
LAN/public deployment.

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

- Phase 1: ADMIN/VIEWER, session, CSRF, rate limit và secure cookies.
- Phase 2: channel resolution, RSS, yt-dlp, snapshots và daily history.
- Phase 3: Playwright public health và deletion safety.
- Phase 4–5: video monitoring và deterministic rankings.
- Phase 6–7: Gemini, NVIDIA, schema validation, cache và fallback router.
- Phase 8: dashboard tiếng Việt hoàn chỉnh.
- Phase 9: Caddy, LAN, Cloudflare Tunnel và public-security smoke tests.
- Phase 10: backup/restore, retention, performance và host-reboot verification.
