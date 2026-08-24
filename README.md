# YouTube Home Monitor

Private dashboard for deterministic monitoring of public YouTube channels.

The project is built phase by phase from
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md). Phases 0–10 provide the
authenticated Vietnamese dashboard, canonical public-channel monitoring, health
and deletion safety, video snapshots/rankings, structured Gemini/NVIDIA AI with
fallback, sync history and collector/runtime settings.

## Runtime baseline

- Node.js 24 LTS
- pnpm 11.22.0
- Docker Desktop with Linux containers

Use `corepack pnpm` in terminals where a global `pnpm` shim is unavailable.

## Clone the current implementation branch

GitHub's default branch may still point at an earlier foundation. Clone the
latest implementation branch explicitly:

```text
git clone --branch codex/phase-10-complete --single-branch https://github.com/duongvh86vn/DashBoard-YTB.git
cd DashBoard-YTB
```

## Fastest local startup

The supported clone startup is Docker-only. Host Node.js, pnpm, Corepack,
`Copy-Item`, and a permanently relaxed PowerShell policy are not required.
Docker Desktop must be running Linux containers.

Windows (cách nhanh nhất): nhấp đúp vào `start.bat` ở thư mục gốc dự án.
Tệp này giữ cửa sổ mở nếu khởi động thất bại để có thể đọc hoặc chụp lại lỗi.

PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

CMD or Git Bash:

```text
scripts\start-local.cmd
```

On the first run the script creates an ignored `.env` with random stable local
secrets, asks for the ADMIN email and hidden password, runs migrations and
starts the stack. Restarting reuses the same `.env` and PostgreSQL volume; it
does not rotate credentials or ask for the ADMIN password again. Open
`http://127.0.0.1:3000/login`. Use `-NoOpen` when automation should not open a
browser.

If an existing `.env` is not the exact LOCAL loopback configuration, the script
stops without overwriting it. If a newly created `.env` does not match an old
volume's PostgreSQL credential, restore the original `.env`; never delete the
volume to work around the error. `docker compose down --remove-orphans` stops
the stack while preserving data. The following is destructive and removes the
database volume only after you have confirmed the project:

```text
docker compose down --volumes --remove-orphans
```

This local setup is loopback-only by default. An optional Caddy hosting profile
is documented in [`docs/HOSTING.md`](./docs/HOSTING.md); it keeps API and
PostgreSQL private. After login, open
`http://127.0.0.1:3000/channels` to add a public channel as ADMIN; the first
snapshot is nullable until a collector succeeds, and no historical values are
fabricated.

## Install and verify

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm verify
pwsh -NoProfile -File .\scripts\assert-hosting-security.ps1
```

The integration gate creates an isolated Compose project, random
credentials and an unused loopback Web port. It exercises real PostgreSQL
migrations, seed idempotency, auth/users/channel authorization, collector
fixtures, health-state transitions, worker and database recovery, the
containerized Playwright browser flow, secret-safe surfaces, and cleanup.

## Runtime topology

Only Web is published, on loopback at `http://127.0.0.1:3000` by default. API,
Worker and PostgreSQL publish no host ports; the database network is internal,
Web does not join it, and Worker has a separate non-published egress network for
public RSS/metadata-only collectors. Every API health route requires an ADMIN
session; there is no anonymous Web `/health` route. Container readiness uses
internal TCP checks.

See [architecture](./docs/ARCHITECTURE.md), [testing](./docs/TESTING.md),
[hosting](./docs/HOSTING.md), [backup/restore](./docs/BACKUP.md) and the
[implementation plan](./IMPLEMENTATION_PLAN.md) for phase boundaries and
verification details.
