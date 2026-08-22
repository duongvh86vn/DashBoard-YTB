# YouTube Home Monitor

Private dashboard for deterministic monitoring of public YouTube channels.

The project is being built phase by phase from
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md). Phase 2 now provides the
authenticated Vietnamese shell, ADMIN/VIEWER sessions, canonical public
YouTube channel resolution, RSS/metadata-only collector contracts, channel
snapshots/daily history, and the ADMIN add-channel flow. Video monitoring,
health/deletion safety, and AI providers remain later phases.

## Runtime baseline

- Node.js 24 LTS
- pnpm 11.22.0
- Docker Desktop with Linux containers

Use `corepack pnpm` in terminals where a global `pnpm` shim is unavailable.

## Clone the Phase 2 branch

GitHub's default branch may still point at the Phase 0 foundation. Clone the
implementation branch explicitly:

```text
git clone --branch codex/phase-2-channel-resolution --single-branch https://github.com/duongvh86vn/DashBoard-YTB.git
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

This local Phase 2 setup is loopback-only. LAN access, public HTTPS, Caddy, and
Cloudflare Tunnel are deferred to Phase 9. After login, open
`http://127.0.0.1:3000/channels` to add a public channel as ADMIN; the first
snapshot is nullable until a collector succeeds, and no historical values are
fabricated.

## Install and verify Phase 2

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm verify:phase2
```

The Phase 2 integration gate creates an isolated Compose project, random
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

See [architecture](./docs/ARCHITECTURE.md), [testing](./docs/TESTING.md) and the
[implementation plan](./IMPLEMENTATION_PLAN.md) for phase boundaries and
verification details.
