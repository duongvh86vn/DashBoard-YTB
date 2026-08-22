# YouTube Home Monitor

Private dashboard for deterministic monitoring of public YouTube channels.

The project is being built phase by phase from
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md). Phase 1 now provides the
authenticated Vietnamese shell, ADMIN/VIEWER sessions, and ADMIN VIEWER
account administration. Channel/video collectors, monitoring metrics, and AI
providers remain later phases.

## Runtime baseline

- Node.js 24 LTS
- pnpm 11.22.0
- Docker Desktop with Linux containers

Use `corepack pnpm` in terminals where a global `pnpm` shim is unavailable.

## Clone the Phase 1 branch

GitHub's default branch may still point at the Phase 0 foundation. Clone the
implementation branch explicitly:

```text
git clone --branch codex/phase-1-auth-users --single-branch https://github.com/duongvh86vn/DashBoard-YTB.git
cd DashBoard-YTB
```

## Fastest local startup

The supported clone startup is Docker-only. Host Node.js, pnpm, Corepack,
`Copy-Item`, and a permanently relaxed PowerShell policy are not required.
Docker Desktop must be running Linux containers.

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

This local Phase 1 setup is loopback-only. LAN access, public HTTPS, Caddy, and
Cloudflare Tunnel are deferred to Phase 9.

## Install and verify Phase 1

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm verify:phase1
```

The Phase 1 integration gate creates an isolated Compose project, random
credentials and an unused loopback Web port. It exercises real PostgreSQL
migrations, seed idempotency, auth/users authorization, health-state
transitions, worker and database recovery, the containerized Playwright browser
flow, secret-safe surfaces, and cleanup.

## Runtime topology

Only Web is published, on loopback at `http://127.0.0.1:3000` by default. API,
Worker and PostgreSQL publish no host ports; the database network is internal,
Web does not join it, and Worker has a separate non-published egress network for
future public collectors/providers. Every API health route requires an ADMIN
session; there is no anonymous Web `/health` route. Container readiness uses
internal TCP checks.

See [architecture](./docs/ARCHITECTURE.md), [testing](./docs/TESTING.md) and the
[implementation plan](./IMPLEMENTATION_PLAN.md) for phase boundaries and
verification details.
