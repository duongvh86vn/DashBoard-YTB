# Worklog

## 2026-08-21 — Phase 0

### Scope and invariant record

- Read all 3,843 lines / 131 sections of the greenfield specification before
  implementation and created `IMPLEMENTATION_PLAN.md` with Phase 0–10 plus
  workstream mapping A–L.
- Locked the critical invariants in the plan. Phase 0 adds only the foundation,
  `worker_heartbeats`, health contracts and operational tests; it does not add
  channel/video/auth/collector/AI behavior.
- Audited Windows, Node.js, pnpm, Git, Docker, WSL, ports, pinned dependency
  compatibility, secret/config assumptions and supply-chain state.
- Work ran on the unborn branch `phase/0-foundation`. At the verification
  timestamp, the greenfield source was not yet committed (27 top-level untracked
  entries); no pre-existing user files were overwritten.

### TDD and review hardening

- Captured red→green tests for strict TypeScript, config parsing, shared health
  schema, logging redaction, database repositories, API health, Worker heartbeat
  lifecycle, Web health/UI and Docker behavior.
- Closed review findings for clean Next type generation, fail-fast standalone Web
  startup, Worker-independent API/Web cold start, bounded DB/query/health/shutdown
  operations, recursive secret-safe logs, exact Docker cleanup and complete 503
  health contracts.
- Added a dedicated non-published Worker egress network while PostgreSQL remains
  only on the internal database network.

### Verification evidence — 2026-08-21T22:55:19+07:00

- `corepack pnpm install --frozen-lockfile` — PASS with pnpm `11.22.0`; the
  24-hour minimum release-age policy and exact lockfile were accepted.
- Clean Next artifact check — PASS: the previous ignored `.next` directory was
  moved aside, `next typegen` regenerated route types, then full verification
  rebuilt the production artifact. Temporary generated backups were moved to the
  Windows Recycle Bin and are recoverable/re-creatable.
- `corepack pnpm verify` — PASS:
  - Prisma schema validation and client generation: PASS.
  - TypeScript typecheck: PASS for root/config/shared/db/web/api/worker.
  - ESLint: PASS with zero warnings.
  - Prettier check: PASS.
  - Unit/HTTP tests: 13 files, 55 tests PASS.
  - Production builds: config/shared/db/Web/API/Worker PASS.
- `corepack pnpm test:integration` — PASS using isolated project
  `ytmonitor-phase0-18292-0c2f4d84`:
  - clean image build and frozen dependency install: PASS;
  - PostgreSQL migration on a fresh schema and repeat deploy with no pending
    migrations: PASS;
  - real PostgreSQL repository suite: 2 files, 4 tests PASS;
  - Web/API/database/Worker health 200 and collector/AI top-level `disabled`: PASS;
  - Web exact loopback binding; API/Worker/PostgreSQL no host ports; exact
    frontend/database/egress topology and internal flags: PASS;
  - heartbeat idempotency leaves one `worker-primary` row: PASS;
  - stopped Worker gives schema-valid stable-code 503 while Web/DB stay 200: PASS;
  - API/Web cold-start while Worker remains stopped: PASS;
  - Worker restart/recovery: PASS;
  - stopped PostgreSQL gives bounded schema-valid stable-code 503 while Web
    process health stays 200, without credential leakage: PASS;
  - project/service/network/volume identities were verified before cleanup;
    containers, volume, three networks and four local images after cleanup: 0.

### Dependency residual and deferred assumptions

- `corepack pnpm audit --prod` reports one known high advisory,
  `GHSA-ggr8-5vv4-36mx`, in `deepmerge-ts@7.1.5` through Prisma config. Upstream
  remediation requires `deepmerge-ts>=8` while Prisma `7.9.1` pins 7.x. No
  unsupported transitive major override was added. Phase 0 only feeds this CLI
  path static repository-owned config; monitor Prisma and rerun all DB gates when
  a supported fix ships.
- Registry/package access, frozen install, Docker image pull/build, loopback bind,
  migrations, failure transitions and cleanup are now evidence-backed.
- Host reboot/autostart remains Phase 10. External domain/DNS/tunnel/mobile tests
  remain Phase 9. Gemini/NVIDIA credentials and calls remain Phase 6/7 and are not
  required for Phase 0.
- Before public collectors ship, assign explicit default-route priority to the
  Worker egress network and add a bounded DNS/outbound smoke. Phase 0 proves exact
  topology/internal flags, not third-party Internet availability.
- Phase 0 Compose intentionally uses the same `http://api:5000` URL at build and
  runtime; a different valid runtime URL is not a supported dynamic rewrite.
  Runtime-driven proxying is deferred until deployment topology needs it.
- Outer `$disconnect()` deadlines, pruned runtime images and digest-pinned bases
  remain non-blocking hardening follow-ups; query/statement/dependency/shutdown
  work is already bounded for Phase 0.
