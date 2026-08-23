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

## 2026-08-22 — Phase 0 clone runtime fix

### Root cause and invariant-safe fix

- A clean clone exposed a pnpm 11 runtime dependency-status check in the
  non-root `db-migrate` container. When pnpm considered `node_modules` stale, it
  attempted an implicit install and failed to create `/app/_tmp_*` with
  `EACCES` because `/app` is intentionally root-owned.
- The migration entrypoint now invokes the installed Prisma CLI directly rather
  than starting a package manager at runtime. The one-shot migration contract,
  `USER node`, startup dependency order, database topology and all critical
  invariants remain unchanged.
- The Docker integration harness now repeats migration deployment with an
  intentionally different runtime pnpm linker setting. Before the fix this
  reproduced the reported implicit-install `EACCES`; after the fix migration is
  idempotent and does not attempt to mutate the image filesystem.

### Verification evidence — 2026-08-22

- RED: `corepack pnpm test:integration` failed in isolated project
  `ytmonitor-phase0-31596-f161ff98` with pnpm install exit 243 and
  `EACCES: permission denied, open '/app/_tmp_*'`.
- GREEN: `corepack pnpm test:integration` passed in isolated project
  `ytmonitor-phase0-26108-9b030a26`, including the new runtime-config drift
  regression, clean/repeat migration, health transitions, network/port
  assertions and verified resource cleanup.
- `corepack pnpm verify` — PASS: Prisma validate/generate, strict typecheck,
  ESLint with zero warnings, Prettier, 13 test files / 55 tests and all
  production builds.

## 2026-08-22 — Phase 1 Auth + Users acceptance

### Scope delivered

- Added server-side opaque sessions, LOCAL/PUBLIC cookie contracts, CSRF,
  identifier-only login throttle, audit-safe authorization, ADMIN/VIEWER roles,
  environment-only bootstrap seed, and the exact Auth/Users REST surface.
- Added Vietnamese login, authenticated dashboard shell and ADMIN VIEWER
  administration UI. There is no signup/OAuth flow and no fabricated monitoring
  metric; channel/video collectors and monitoring data remain later phases.
- Removed anonymous Web `/health`; API health remains ADMIN-only and Docker
  readiness uses internal TCP probes. The local quick start is Docker-only and
  preserves the PostgreSQL volume and generated `.env` secrets across restarts.

### Acceptance evidence — 2026-08-22

- `corepack pnpm test:auth:integration` — PASS: isolated PostgreSQL migrations
  fresh/replay, seed `CREATED` + `UNCHANGED`, 28 files / 122 tests, bounded
  verified post-DONE image renderer termination, and cleanup of all isolated
  containers/networks/volumes/images.
- `corepack pnpm test:integration` — PASS: 28 raw database files / 122 tests,
  full seed and identity aggregate checks, exact network/port topology, health
  authorization and check-key matrix, worker/PostgreSQL outage and recovery,
  API/Web cold start, Auth/Users lifecycle matrix, Vietnamese Playwright ADMIN →
  VIEWER flow, secret-safe database/log/artifact scans, and cleanup of all
  isolated containers/networks/volumes/images. Six Compose build renderer
  terminations were verified after complete image export and left no process.

### Operational constraints preserved

- Public Internet remains login-protected; only credential submission at login is
  anonymous. PostgreSQL, Worker, API and Playwright debug surfaces are not public.
- User APIs remain VIEWER-readable/ADMIN-target-protected as specified; DELETE
  is a disable alias. No LAN/public HTTPS claim is made before Phase 9.
- No credentials, raw cookies, session tokens, passwords or connection URLs were
  written to this worklog.

## 2026-08-22 — Phase 2 Channel resolution + collectors acceptance

### Scope delivered

- Added canonical channel contracts and normalization for `@handle`, handle URL,
  `/channel/UC...` and canonical UC IDs. A Channel cannot be persisted without a
  canonical `youtube_channel_id`; duplicate canonical IDs map to the narrow
  conflict error.
- Added metadata-only yt-dlp runner with bounded timeout/output, concurrency
  limiter, normalized failures and media-download flag rejection. Docker base
  images install `yt-dlp` and verify `yt-dlp --version` during the image build.
- Added RSS Atom fetch/parse/dedup, public-page canonical fallback, nullable
  Channel snapshots, daily deltas/coverage and SyncRun persistence, plus worker
  job services for RSS discovery, current stats and daily finalization.
- Added ADMIN REST/UI add/list/archive channel flow and VIEWER read-only route in
  Vietnamese. No OAuth, private API, vidIQ backend, fabricated historical data,
  or AI-derived metrics were introduced.

### Acceptance evidence — 2026-08-22

- `corepack pnpm verify` — PASS: Prisma validate/generate, strict typecheck,
  ESLint zero warnings, Prettier, 56 files / 381 unit tests and all production
  builds; Next routes include `/channels` and `/channels/new`.
- `corepack pnpm test:phase2:collectors` — PASS: 8 files / 24 collector,
  normalization, safety, history and worker-job fixture tests.
- `corepack pnpm test:auth:integration` — PASS: three migrations fresh/replay,
  Channel/Snapshot/DailyStat/SyncRun repositories included, 34 files / 140
  tests, isolated cleanup.
- `corepack pnpm test:integration` — PASS after the Phase 2 Docker image change:
  real Compose topology, migration replay, API authorization (anonymous
  Channels 401, VIEWER read-only, ADMIN validation), Vietnamese browser routes,
  recovery checks, secret-safe surfaces and verified cleanup. The browser gate
  intentionally does not submit a live public URL; the separate live smoke below
  covers that network-dependent operation.
- Live public smoke — PASS: `https://www.youtube.com/@miumiutruyenaudio` returned
  HTTP 200 and the public collector resolved canonical ID
  `UCwW1I1xnLWhLC74pUHXnKxg`, handle and title without media download.

### Boundaries preserved

- Public Internet remains behind authenticated application routes; PostgreSQL,
  API and Worker are not host-published. Missing metrics remain `NULL`, daily
  negative deltas are preserved, and no false-delete state machine or full
  Playwright health parser is claimed before Phase 3.

## 2026-08-22 — Phase 3 Public health + deletion safety acceptance

### Scope delivered

- Added an anonymous fresh Chromium context with `en-US` locale, bounded
  public-page render, visible-text/title-only detectors, compact metric parsing
  and sanitized evidence. Full HTML, cookies, storage state and raw upstream
  response bodies are not persisted.
- Added separate availability/activity handling, 30-minute retry scheduling,
  temporal/independent strong-failure confirmation, recovery reset and a
  provider-incident circuit breaker. Block/CAPTCHA, timeout, network, layout and
  collector failures remain non-deletion outcomes.
- Added `ChannelHealthCheck` persistence and indexes, worker health
  job/scheduler, safe SyncRun lifecycle, ADMIN health-check queue endpoint,
  authenticated health history endpoint and Vietnamese UI history surface.
  Manual checks are queued for the worker; the API does not bypass the worker's
  evidence boundary.
- Worker production image now uses the pinned Playwright runtime and retains
  metadata-only `yt-dlp` execution. `PLAYWRIGHT_EXECUTABLE_PATH` remains
  optional; the image's bundled browser is the default.

### Acceptance evidence — 2026-08-22

- `corepack pnpm db:validate`, `corepack pnpm db:generate`,
  `corepack pnpm typecheck`, `corepack pnpm lint`,
  `corepack pnpm format:check`, `corepack pnpm test:unit` and
  `corepack pnpm build` — PASS; unit suite: 64 files / 402 tests.
- Phase 3 targeted suite — PASS: 16 files / 62 tests covering false-delete,
  retry/confirmation/recovery, circuit breaker, sanitized evidence, render
  lifecycle, worker job/scheduler and API health queue/history.
- `corepack pnpm test:auth:integration` — PASS: clean/replay of all 4 migrations,
  40 files / 146 tests, including channel health history persistence and safe
  evidence fields.
- `corepack pnpm test:integration` — PASS: isolated Compose migration replay,
  Worker/API/Web health, Playwright E2E, exact topology and cleanup. The Worker
  image started healthy with the Playwright browser runtime.

### Boundaries and residual assumptions

- `DELETED_OR_TERMINATED` is only produced by the shared state machine after the
  configured strong confirmations; circuit-open provider incidents preserve the
  prior channel state. Activity remains separate and is derived from channel
  upload metadata by the existing 30-day helper.
- A queued manual health check is consumed on the worker schedule; a dedicated
  queue broker is intentionally not introduced. Live third-party YouTube health
  smoke remains network-dependent and is not used as the deterministic
  integration gate.
- No full HTML, raw cookies, auth bypass, OAuth/API key, vidIQ backend or AI
  input was introduced. These invariants remain unchanged.

## 2026-08-22 — Phase 4 Video discovery + snapshot monitoring acceptance

### Scope delivered

- Added `Video`/`VideoSnapshot` schema and migration with nullable counters,
  monitor tiers, candidate indexes and unique `(video_id, snapshot_bucket)`.
- Added RSS-first discovery every 15 minutes, bounded yt-dlp reconciliation on
  the channel scan interval, canonical-channel filtering and metadata upserts.
- Added deterministic HOT/WARM/OLD_HOT/PINNED tiering, hourly/3-hour/6-hour
  snapshot cadence, retry and in-flight run locks, and nullable yt-dlp metric
  snapshots. Repeated execution upserts the same UTC hour bucket.
- Added authenticated API routes for channel videos and snapshot history, plus
  the Vietnamese video-monitor UI route.

### Acceptance evidence — 2026-08-22

- `corepack pnpm db:validate`, `corepack pnpm db:generate`,
  `corepack pnpm typecheck`, `corepack pnpm lint`,
  `corepack pnpm format:check`, `corepack pnpm test:unit` — PASS;
  67 files / 416 tests.
- `corepack pnpm build` — PASS; Next route `/channels/[id]/videos` included.
- `corepack pnpm test:auth:integration` — PASS; clean/replay of all 5
  migrations and 40 files / 146 tests.
- `corepack pnpm test:integration` — PASS; isolated Compose, API/Web/Worker
  health and Playwright acceptance with Phase 4 migration applied.

### Boundaries preserved

- No views/likes/comments are fabricated when providers return no value;
  derived VPH/breakout fields remain `NULL` for the later analytics phase.
- RSS remains the frequent discovery source; yt-dlp is metadata reconciliation
  and stats collection only. No media download, OAuth/API key or backfill was
  introduced. Snapshot retention deletion is deferred until rollups exist.

## 2026-08-23 — Phase 5 Deterministic rankings

### Scope delivered

- Added the standalone `@yt-monitor/analytics` package with pure nullable
  snapshot functions for signed weekly gain, 1h/3h/6h VPH, 70/30 smoothed VPH,
  same-channel breakout benchmarks, deterministic median/p75/p90 percentiles,
  coverage and stable tie-broken rankings.
- Added ranking query repositories with a bounded candidate read, deterministic
  ordering, channel metadata and snapshot history; no schema migration was
  needed because Phase 4 already owns the required ranking indexes.
- Added authenticated `GET /videos`, `/videos/:id`, `/videos/:id/snapshots`,
  `/videos/recent`, `/videos/rankings/weekly`, `/videos/rankings/hot` and
  `/videos/rankings/breakout` endpoints with strict UUID/query validation and
  server pagination.
- Added the Vietnamese `/videos` dashboard route with independent Weekly,
  Hot Now and Breakout panels, explicit `WARMING_UP`/unknown states and no
  lifetime-view substitution.

### Acceptance evidence — 2026-08-23

- `corepack pnpm db:validate`, `corepack pnpm db:generate`, `corepack pnpm typecheck`,
  `corepack pnpm lint`, `corepack pnpm format:check`, `corepack pnpm build` — PASS.
- `corepack pnpm test:unit -- --maxWorkers=1` — PASS: 75 files / 435 tests.
- Ranking-targeted tests — PASS: 8 files / 19 tests, including exact §97–§99
  fixtures, negative corrections, NULL/warm-up, pagination and 404 behavior.
- `corepack pnpm test:auth:integration` — PASS: clean/replay of all 5 migrations,
  40 files / 146 tests.
- `corepack pnpm test:integration` — PASS: isolated Compose, API/Web/Worker
  health, topology, migration replay and Playwright acceptance.

### Boundaries preserved

- Weekly gain is never replaced by current lifetime views; missing or stale
  baselines remain `WARMING_UP`, and signed negative corrections remain signed.
- Hot Now and Breakout are separate deterministic rankings; breakout samples are
  restricted to comparable videos from the same channel and NULL/zero baselines
  do not produce fabricated multiples.
- AI, YouTube API/OAuth, media downloads, fake historical backfill and raw
  provider payload persistence remain out of scope.

## 2026-08-23 — Phase 6 Gemini structured AI foundation

### Scope delivered

- Added `@yt-monitor/crypto`: authenticated AES-256-GCM envelopes, strict
  32-byte key validation and masked-secret output. API settings never return a
  full provider key.
- Added `@yt-monitor/ai`: provider contract, Gemini structured JSON transport,
  Zod schemas for classification/video/daily/weekly/health outputs, safe error
  codes, one repair retry, health state, fallback router, stable fingerprints
  and TTL cache. AI receives aggregate JSON only.
- Added Phase 6 Prisma migration/models and repositories for provider settings,
  model roles, run logs, channel/video analyses and reports. Existing channel and
  video canonical metrics remain separate from AI results.
- Added API status/settings/classification endpoints with ADMIN write policy and
  a Vietnamese ADMIN settings screen. Added a worker report job that explicitly
  skips when AI is disabled and never blocks core collection/rankings.

### Acceptance evidence — 2026-08-23

- Targeted AI/crypto/worker/health suite — PASS: 4 files / 17 tests.
- `corepack pnpm db:validate`, `corepack pnpm db:generate` — PASS.
- `corepack pnpm typecheck` — PASS across all workspace packages.
- Global gates — PASS: `corepack pnpm typecheck`, `corepack pnpm lint`,
  `corepack pnpm format:check`, 78 files / 446 unit tests and workspace build.
- Clean migration replay applied all 6 migrations. Auth integration — PASS:
  40 files / 146 tests. Full Compose/API/Worker/Web/Playwright acceptance — PASS
  with AI unconfigured, proving core monitoring remains available without AI.

### Boundaries preserved

- `AI != DATA SOURCE`: AI outputs are validated and stored only in AI tables;
  raw metrics, rankings, health state and Channel ID are never written by AI.
- API keys are encrypted at rest with `SECRET_ENCRYPTION_KEY`; no raw key is
  logged, persisted in run logs or sent to the browser.
- Provider failure, rate limiting, malformed JSON and disabled mode return safe
  AI status while leaving the deterministic dashboard path available.
