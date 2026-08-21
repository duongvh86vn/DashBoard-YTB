# Kiểm thử Phase 0

Đây là runbook tạo evidence cho Phase 0, không phải tuyên bố rằng các gate hiện
đã pass. Chỉ ghi trạng thái hoàn tất sau khi command thực tế exit code 0 và output
được lưu vào `WORKLOG.md` hoặc artifact tương đương.

## Điều kiện tiên quyết

- Windows 10/11 với PowerShell 7 (`pwsh`).
- Node.js `>=24 <25` và Corepack.
- Docker Desktop đang chạy Linux containers; Docker Compose hỗ trợ `--wait`.
- Registry/package download và Docker image pull khả dụng.
- Không có process khác chiếm loopback port được chọn.

Kiểm tra nhanh:

```powershell
node --version
corepack --version
docker version
docker compose version
```

## Cài dependency

Repo pin pnpm trong `packageManager`; dùng `corepack pnpm` nếu máy không có pnpm
shim toàn cục.

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
```

`prisma generate` và `prisma validate` không kết nối database. Mọi command thật sự
kết nối PostgreSQL phải nhận `DATABASE_URL` rõ ràng.

## Quality gates cục bộ

Chạy riêng để khoanh vùng lỗi:

```powershell
corepack pnpm db:generate
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test:unit
corepack pnpm build
```

Gate tổng hợp không dùng Docker:

```powershell
corepack pnpm verify
```

Kỳ vọng để được ghi là đạt: mọi command exit code 0, lint không có warning, unit
tests pass và cả Web/API/Worker/package builds hoàn thành. Không suy ra kết quả từ
việc file hoặc test tồn tại.

## Docker integration gate

Command chuẩn:

```powershell
corepack pnpm test:integration
```

Hoặc toàn bộ Phase 0 gate:

```powershell
corepack pnpm verify:phase0
```

Integration harness tự:

1. Tạo Compose project name, Web loopback port và PostgreSQL password ngẫu nhiên.
2. Build và boot PostgreSQL/migration, rồi Worker và API độc lập; Web chờ API
   DB-readiness chứ không chờ Worker.
3. Xác minh Web/API/DB/Worker trả HTTP 200 và đúng health schema.
4. Xác minh collector/AI trả HTTP 200 với top-level status `disabled`.
5. Xác minh Web chỉ bind đúng một port `127.0.0.1`; PostgreSQL/API/Worker không
   publish host port. Web và PostgreSQL không chia sẻ network, API nối đúng một
   frontend và một database network, Worker nối đúng database + egress, frontend
   và egress là bridge còn database là internal.
6. Chạy migration lặp lại trên schema test và chạy real-PostgreSQL repository
   tests (`SELECT 1`, heartbeat idempotency, database-time freshness và lookup
   đúng `worker_id`).
7. Xác minh nhiều heartbeat của `worker-primary` vẫn chỉ tạo một row.
8. Stop Worker: worker/aggregate health phải có schema hợp lệ, `no-store`, đúng
   stable failure code và HTTP 503 trong khi DB/Web còn 200. Recreate API/Web khi
   Worker vẫn dừng để chứng minh cold start không bị chặn; restart Worker phải
   phục hồi.
9. Stop PostgreSQL: DB/aggregate health phải có schema hợp lệ, `no-store`, đúng
   stable failure code và HTTP 503 mà không lộ URL/password; Web process health
   vẫn 200.
10. Trong `finally`, xác minh project/container/network/volume labels trước khi
    xóa, kiểm tra exit code, chứng minh isolated containers, volume, network và
    local image không còn, rồi phục hồi các environment variable trước đó.

Test này không dùng hoặc xóa named volume của manual/default Compose project.

## Boot stack thủ công

Khác integration harness, manual Compose bắt buộc caller cấp ít nhất
`POSTGRES_PASSWORD` và `DATABASE_URL`. `DATABASE_URL` dùng hostname service
`postgres`, không dùng `localhost`, vì API/Worker chạy trong container.

Ví dụ PowerShell; thay password bằng giá trị URL-safe ngẫu nhiên và không commit:

```powershell
$env:POSTGRES_USER = 'youtube_monitor'
$env:POSTGRES_PASSWORD = '<random-url-safe-password>'
$env:POSTGRES_DB = 'youtube_monitor'
$env:DATABASE_URL = "postgresql://youtube_monitor:$($env:POSTGRES_PASSWORD)@postgres:5432/youtube_monitor"

docker compose up -d --build --wait
docker compose ps
corepack pnpm docker:health
```

Compose phải fail fast nếu `POSTGRES_PASSWORD` hoặc `DATABASE_URL` thiếu. Nếu dùng
ký tự đặc biệt trong password, phải percent-encode chúng trong `DATABASE_URL`.
Không đưa credential vào source, command transcript công khai hoặc log artifact.

Health kiểm tra thủ công:

```powershell
Invoke-WebRequest http://127.0.0.1:3000/health
Invoke-WebRequest http://127.0.0.1:3000/api/v1/health
Invoke-WebRequest http://127.0.0.1:3000/api/v1/health/collectors
Invoke-WebRequest http://127.0.0.1:3000/api/v1/health/ai
```

## Dọn dẹp

Dừng manual stack nhưng giữ PostgreSQL volume:

```powershell
docker compose down --remove-orphans
```

Chỉ với stack dùng thử có thể bỏ toàn bộ dữ liệu, sau khi xác nhận đúng Compose
project:

```powershell
docker compose down --volumes --remove-orphans
```

Lệnh thứ hai xóa named PostgreSQL volume và không thể khôi phục nếu không có
backup. Integration harness chỉ chạy thao tác này trên project/volume cô lập mà
nó tự tạo.

Có thể xóa credential khỏi PowerShell session sau manual test:

```powershell
Remove-Item Env:POSTGRES_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
```

## Evidence tối thiểu

Trước khi đánh dấu Phase 0 hoàn tất, lưu:

- timestamp, commit/worktree state và exact commands;
- exit code/output của `corepack pnpm verify:phase0`;
- migration sạch và repeat-deploy evidence;
- health status Web/API/DB/Worker cùng collector/AI `disabled` evidence;
- port/network-isolation assertions;
- worker stale/recovery và database failure/no-secret-leak evidence;
- cleanup result và blocker/assumption còn lại.

Một scaffold, unit-test-only run hoặc `docker compose up` chưa có integration
evidence không đủ để tuyên bố Phase 0 hoàn tất.
