# YouTube Home Monitor

Private dashboard for deterministic monitoring of public YouTube channels.

The project is being built phase by phase from
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md). Phase 0 establishes a
healthy Web/API/Worker/PostgreSQL foundation; it does not collect YouTube data
or call AI providers.

## Runtime baseline

- Node.js 24 LTS
- pnpm 11.22.0
- Docker Desktop with Linux containers

Use `corepack pnpm` in terminals where a global `pnpm` shim is unavailable.

## Install and verify Phase 0

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm verify:phase0
```

The Phase 0 integration gate creates an isolated Compose project, random
database credential and unused loopback Web port. It exercises real PostgreSQL
migrations and repository tests, health-state transitions, worker restart, port
isolation and cleanup.

## Run the local stack

Copy `.env.example` to the ignored `.env` file, replace both database password
placeholders, and URL-encode the password in `DATABASE_URL`.

```powershell
Copy-Item .env.example .env
corepack pnpm docker:up
corepack pnpm docker:health
corepack pnpm docker:down
```

Only Web is published, on loopback at `http://127.0.0.1:3000` by default. API,
Worker and PostgreSQL publish no host ports; the database network is internal,
Web does not join it, and Worker has a separate non-published egress network for
future public collectors/providers. Host-side Prisma commands require an explicit
host-reachable `DATABASE_URL`; the safe fallback used by generate/validate cannot
connect to a database.

See [architecture](./docs/ARCHITECTURE.md), [testing](./docs/TESTING.md) and the
[implementation plan](./IMPLEMENTATION_PLAN.md) for phase boundaries and
verification details.
