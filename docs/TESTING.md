# Kiểm thử hiện hành (Phase 0–12)

Hệ thống có bốn lớp kiểm thử: quality gates cục bộ, collector
fixtures, PostgreSQL/auth/access-scope integration và full-stack Docker/browser
acceptance. Chỉ ghi trạng thái đạt khi command thật đã exit code 0.

## Điều kiện tiên quyết

- Windows 10/11 với PowerShell 7 (`pwsh`) cho các integration scripts.
- Node.js `>=24 <25`, Corepack và pnpm `11.22.0`.
- Docker Desktop đang chạy Linux containers; Docker Compose hỗ trợ `--wait`.
- Registry/package download và Docker image pull khả dụng.

Kiểm tra nhanh:

```powershell
node --version
corepack --version
docker version
docker compose version
```

## Cài dependency và quality gates

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:validate
corepack pnpm db:generate
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build
```

Collector/channel job fixtures:

```powershell
corepack pnpm test:phase2:collectors
```

Phase 12 cần giữ test-first coverage cho các contract sau trong gate unit chung:

- Full-upload catalog không bị cap theo recent limit, không tải media và giữ
  public view/like/comment counter thiếu là `NULL`.
- Một scan idempotent cho mỗi channel/local-day; coverage `COMPLETE` chỉ khi mọi
  upload được liệt kê đều có public view evidence.
- Daily leader dùng hai catalog bucket canonical, tối đa một winner mỗi kênh,
  tie deterministic; video mới thiếu baseline không được coi là bắt đầu từ zero.
- RPM parse/format chính xác đến sáu chữ số thập phân, lưu micro-USD, chọn row
  hiệu lực theo ngày và reject future/malformed/non-monetized RPM writes.
- Revenue giữ signed public correction, làm tròn half-away-from-zero, phân biệt
  explicitly disabled zero với unconfigured/missing `NULL`, và không xuất strict
  total khi coverage chỉ partial.
- Group/channel selectors truyền cùng scope vào KPI, timeline, revenue và daily
  leader feed; VIEWER UI read-only, ADMIN mới có monetization controls.

Gate tổng hợp tương đương là `corepack pnpm verify`. Root typecheck bao gồm
Playwright config/tests; Vitest loại trừ `tests/e2e/**`.

## Auth database integration

```powershell
corepack pnpm test:auth:integration
```

Script tạo Compose project và credential cô lập, chạy PostgreSQL thật,
migration sạch/lặp lại, seed `CREATED` rồi `UNCHANGED`, và chạy repository
integration trong schema riêng, gồm Channel/Snapshot/DailyStat/SyncRun,
`ChannelGroup`, `ChannelGroupChannel`, `UserChannelGroup`, `VideoCatalogScan`,
effective-dated `ChannelMonetizationSetting`, audit và access scope. Integration
phải chứng minh catalog upsert idempotent, RPM history không bị overwrite, và
các endpoint revenue/daily-video-leaders chỉ trả cohort do server cho phép.
Nó không gọi wrapper full-stack lồng nhau, không in raw logs có thể chứa
bí mật, và luôn kiểm tra ownership trước cleanup.

## Full-stack Docker/browser acceptance

```powershell
corepack pnpm test:integration
```

Harness tự tạo project/port/credential ngẫu nhiên và dọn riêng toàn bộ tài nguyên
của nó. Nó kiểm tra:

- Compose topology: chỉ Web bind loopback; API/Worker/PostgreSQL không publish
  host port; database network internal; E2E chỉ vào frontend network.
- Migration replay, seed idempotency, exact identity aggregate và secret-safe
  database/log/artifact surfaces.
- Web `/health` không tồn tại; anonymous API health/Auth/Users/Channels nhận 401,
  VIEWER nhận 403 trên tám route Users, ADMIN target bị bảo vệ, và CSRF exact
  Origin/header policy.
- ADMIN login, health contracts, tạo/sửa/reset/revoke/disable/enable VIEWER;
  list channel, invalid add-channel input và VIEWER channel read-only;
  logout, đổi mật khẩu và disabled/revoked session invalidation.
- Group authorization: VIEWER không có nhóm thì deny-all; nhiều nhóm lấy
  union có dedup; group bị archive thu hồi quyền; tài nguyên được gán
  đọc được, tài nguyên ngoài scope trả 404, và thay membership có hiệu
  lực ngay trên session hiện tại.
- Metric contracts: public subscriber zero được phân biệt với missing;
  observed partial timeline giữ coverage và negative public corrections thay
  vì ép về zero.
- Phase 12 metric contracts: full-catalog warm-up/partial/unavailable không giả
  winner; daily feed trả video tăng view cao nhất theo từng channel-day thay vì
  video mới; revenue phân biệt strict total, observed partial và unknown `NULL`.
- Authorization/UI: group/channel selector áp dụng nhất quán cho trends,
  daily-video-leaders và revenue; VIEWER chỉ đọc trong assigned-group union,
  ADMIN write RPM được audit, out-of-scope/mismatched selection trả 404.
- Wording: revenue luôn hiện là ước tính từ RPM thủ công; AI không tính metric,
  và không surface nào yêu cầu Google login, private YouTube Analytics, vidIQ
  backend/extension hoặc browser cookie.
- Worker stop/recovery, PostgreSQL stop/recovery, API/Web cold start và bounded
  process health.
- Containerized `mcr.microsoft.com/playwright:v1.62.1-noble` với Node 24,
  pnpm 11.22, one worker, zero retries; browser flow ADMIN → VIEWER read-only
  shell → ADMIN disable → redirect login. Không signup/OAuth/fabricated metrics.
- Verified cleanup: containers, networks, volumes and project images đều vắng
  mặt sau khi test kết thúc.

`test:e2e` chỉ chạy trong container acceptance với `E2E_BASE_URL=http://web:3000`;
không tự khởi động server trên host.

## Public yt-dlp runtime smoke

Đây là probe tùy chọn có truy cập YouTube công khai, không nằm trong gate unit ổn
định và không dùng Google login, cookie hay private Analytics. Sau khi build image
Worker, chạy:

```powershell
docker build --target worker --tag ytmonitor-ytdlp-probe:local --file docker/Dockerfile .
pwsh -NoProfile -File scripts/test-ytdlp-public.ps1 -ImageRef ytmonitor-ytdlp-probe:local
```

Probe dùng đúng uploads playlist và đúng tham số metadata-only của production. Nó
thất bại nếu playlist khai báo dữ liệu nhưng runtime phát ra rỗng, nếu entry sai
canonical channel ID, hoặc nếu toàn bộ public view counter đều thiếu. Output chỉ
ghi version và số lượng, không ghi title hay dữ liệu nhạy cảm.

## Local startup smoke

Clone đúng branch rồi chạy Docker-only quick start:

```text
git clone --branch phase/0-foundation --single-branch https://github.com/duongvh86vn/DashBoard-YTB.git
cd DashBoard-YTB
start.bat
```

Với clone đã có sẵn, cập nhật source trước khi khởi động:

```powershell
git switch phase/0-foundation
git pull --ff-only origin phase/0-foundation
.\start.bat
```

PowerShell dùng `powershell -NoProfile -ExecutionPolicy Bypass -File
.\\scripts\\start-fast.ps1`; `-NoOpen` dành cho automation. Script tạo `.env`
LOCAL lần đầu, giữ secret/volume ổn định, hỏi ADMIN password ẩn chỉ khi database
chưa có user (6–128 ký tự), tải image dựng sẵn rồi mở
`http://127.0.0.1:3000/login`. Nó dừng
an toàn nếu `.env` hiện hữu không khớp contract LOCAL; không tự rotate secret
hay xóa volume. `setup.bat` là đường sửa chữa/build đầy đủ, không phải lệnh cần
chạy ở mỗi lần mở ứng dụng.

## Dọn dẹp

Giữ dữ liệu PostgreSQL:

```text
docker compose down --remove-orphans
```

Xóa dữ liệu chỉ sau khi đã xác nhận đúng Compose project:

```text
docker compose down --volumes --remove-orphans
```

> Lệnh có `--volumes` là destructive và không thể khôi phục database nếu không có
> backup. LAN/Caddy có smoke contract trong Phase 9; public HTTPS/mobile smoke
> vẫn cần domain và tunnel credentials của owner.

Live public YouTube smoke không phải điều kiện bắt buộc của isolated Docker
gate vì upstream có thể rate-limit hoặc không khả dụng; khi chạy được, kiểm tra
`@handle`/`/channel/UC...` phải trả cùng canonical ID và không tải media.

## Evidence tối thiểu

Ghi timestamp, branch/commit, exact commands, counts, topology/outage/recovery,
browser result, secret-scan result và cleanup result vào `WORKLOG.md`. Không ghi
credential, raw cookie, token, password hay connection URL thật.
