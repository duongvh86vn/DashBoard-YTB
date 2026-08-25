# Kiểm thử Phase 2

Phase 2 có bốn lớp kiểm thử: quality gates cục bộ, collector fixtures, auth-DB
integration và full-stack Docker/browser acceptance. Chỉ ghi trạng thái đạt khi command thật
đã exit code 0.

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

Gate tổng hợp tương đương là `corepack pnpm verify`. Root typecheck bao gồm
Playwright config/tests; Vitest loại trừ `tests/e2e/**`.

## Auth database integration

```powershell
corepack pnpm test:auth:integration
```

Script tạo Compose project và credential cô lập, chạy PostgreSQL thật,
migration sạch/lặp lại, seed `CREATED` rồi `UNCHANGED`, và chạy repository
integration trong schema riêng, gồm Channel/Snapshot/DailyStat/SyncRun. Nó
không gọi wrapper full-stack lồng nhau, không in raw logs có thể chứa bí mật,
và luôn kiểm tra ownership trước cleanup.

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
- Worker stop/recovery, PostgreSQL stop/recovery, API/Web cold start và bounded
  process health.
- Containerized `mcr.microsoft.com/playwright:v1.62.1-noble` với Node 24,
  pnpm 11.22, one worker, zero retries; browser flow ADMIN → VIEWER read-only
  shell → ADMIN disable → redirect login. Không signup/OAuth/fabricated metrics.
- Verified cleanup: containers, networks, volumes and project images đều vắng
  mặt sau khi test kết thúc.

`test:e2e` chỉ chạy trong container acceptance với `E2E_BASE_URL=http://web:3000`;
không tự khởi động server trên host.

## Local startup smoke

Clone đúng branch rồi chạy Docker-only quick start:

```text
git clone --branch phase/0-foundation --single-branch https://github.com/duongvh86vn/DashBoard-YTB.git
cd DashBoard-YTB
start.bat
```

PowerShell dùng `powershell -NoProfile -ExecutionPolicy Bypass -File
.\\scripts\\start-fast.ps1`; `-NoOpen` dành cho automation. Script tạo `.env`
LOCAL lần đầu, giữ secret/volume ổn định, hỏi ADMIN password ẩn chỉ khi database
chưa có user, tải image dựng sẵn rồi mở `http://127.0.0.1:3000/login`. Nó dừng
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
