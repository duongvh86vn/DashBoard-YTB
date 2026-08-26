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
  8 canonical files / 37 tests, including channel health history persistence and safe
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
  migrations and 8 canonical files / 37 tests.
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
  8 canonical files / 37 tests.
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
  8 canonical files / 37 tests. Full Compose/API/Worker/Web/Playwright acceptance — PASS
  with AI unconfigured, proving core monitoring remains available without AI.

### Boundaries preserved

- `AI != DATA SOURCE`: AI outputs are validated and stored only in AI tables;
  raw metrics, rankings, health state and Channel ID are never written by AI.
- API keys are encrypted at rest with `SECRET_ENCRYPTION_KEY`; no raw key is
  logged, persisted in run logs or sent to the browser.
- Provider failure, rate limiting, malformed JSON and disabled mode return safe
  AI status while leaving the deterministic dashboard path available.

## 2026-08-23 — Phase 7 NVIDIA provider and fallback router

### Scope delivered

- Added an OpenAI-compatible NVIDIA/NIM provider for configurable `/v1/models`
  discovery and `/v1/chat/completions`, including bearer authentication,
  structured JSON validation, one repair retry, health checks and safe error
  mapping for rate limits, credentials and network failures.
- Extended the AI router with logical `FAST`, `ANALYSIS`, `LONG_CONTEXT` and
  `FALLBACK` roles. Gemini remains primary by default; provider failures route to
  configured NVIDIA fallback models. Both-fail returns a safe AI-unavailable error.
- Wired API startup to both providers using environment model IDs without
  hard-coding DeepSeek/Kimi/Z-AI names. Added ADMIN-only provider test/model
  discovery endpoints and persisted selected role model IDs.
- Updated the Vietnamese settings page with provider tabs, model discovery,
  provider test and masked API-key controls.

### Acceptance evidence — 2026-08-23

- Phase-specific AI suite — PASS: 2 files / 13 tests (NVIDIA protocol, discovery,
  repair/schema validation, 429 handling, role routing, fallback and both-fail).
- Global gates — PASS: workspace typecheck, ESLint zero warnings, Prettier,
  production build and 79 files / 453 unit tests.
- Clean six-migration Compose/API/Worker/Web/Playwright acceptance — PASS with AI
  unconfigured; core monitoring remains healthy and no renderer process remained
  after teardown.

### Boundaries preserved

- NVIDIA model IDs are discovered or ADMIN-configured; no vendor model is
  hard-coded. Fallback never changes canonical metrics, rankings or health state.
- AI keys remain encrypted at rest and are never returned in full. Provider or
  router outage leaves deterministic collection/dashboard paths available.

## 2026-08-23 — Phase 8 dashboard completion

### Scope delivered

- Replaced the Phase 1 placeholder home page with a real Vietnamese monitoring
  dashboard: channel coverage, active channels, known videos, weekly ranking,
  recent uploads, freshness labels, empty states and ADMIN service health cards.
- Added channel detail and ADMIN analyze-channel action, server-paginated sync-run
  history, collector settings boundary, AI daily/weekly availability cards and
  navigation for `/sync` and `/settings/collectors`.
- Added typed browser contracts and pagination controls for channels, videos and
  health history. Raw metrics and AI status remain separate; no metric is
  fabricated when snapshots or baselines are missing.

### Acceptance evidence — 2026-08-23

- Web dashboard/component targeted suite — PASS: 3 files / 7 tests.
- Workspace typecheck, lint, format and production build — PASS; routes include
  `/channels/[id]`, `/sync` and `/settings/collectors`.
- Full Compose/API/Worker/Web/Playwright acceptance — PASS: six migrations,
  8 canonical files / 37 database and auth integration tests, browser flow and cleanup.

## 2026-08-23 — Phase 9/10 completion (repository-owned scope)

### Scope delivered

- Added loopback-safe Web binding and an optional Caddy hosting profile. Caddy
  routes `/api/*` to the internal API, sends baseline security headers and keeps
  persistent config/data volumes; API, Worker and PostgreSQL remain unpublished.
- Added hosting security and restart-policy assertions, LAN/public deployment
  documentation, checksum-reporting database backup and guarded restore scripts,
  backup contract tests and retention-safety guidance.
- Kept Cloudflare credentials, DNS, mobile-network HTTPS and target-host reboot
  actions explicitly outside the repository change boundary.

### Acceptance evidence — 2026-08-23

- `assert-hosting-security.ps1` — PASS for default and `hosting` profiles.
- `verify-restart-policy.ps1` — PASS.
- Workspace typecheck/lint/format/build/unit and full Compose/browser integration
  — PASS.

### Remaining owner-run acceptance

- Supply the real public domain/tunnel token, set `DEPLOYMENT_MODE=PUBLIC` and
  `TRUST_PROXY=true`, then run the mobile-network HTTPS smoke.
- Run one real backup → checksum → restore → row-count verification and one
  Docker host reboot/startup check against the intended persistent volume.

## 2026-08-23 — Final audit remediation

### Defects fixed

- Bootstrap now performs its expensive Argon2 hash outside the transaction-wide
  advisory-lock window, then reacquires the same lock and re-checks the complete
  identity state before the only possible ADMIN insert. Existing matching ADMINs
  still return `UNCHANGED` without password hashing, verification or reset.
- Integration discovery is limited to canonical `apps/**` and `packages/**`
  sources and explicitly excludes dependency/build trees. Workspace symlinks no
  longer execute the same database test file multiple times.
- Added a narrow workspace override from Prisma's transitive `deepmerge-ts@7.1.5`
  to patched `8.0.2`. Prisma's runtime call uses the preserved `deepmerge`
  entrypoint; no application/provider contract changes.

### Acceptance evidence

- Isolated PostgreSQL concurrent-bootstrap regression — PASS: 1 file / 2 tests.
- Frozen install and Prisma validate/generate — PASS; production dependency audit
  reports no known vulnerabilities with `deepmerge-ts@8.0.2`.
- Global validate/generate/typecheck/lint/format/unit/build gate — PASS: 80 files /
  456 unit tests.
- Clean six-migration Compose/API/Worker/Web/Playwright acceptance — PASS: 8
  canonical database/auth integration files / 37 tests, browser flow, recovery
  checks and complete cleanup.
- Default/hosting security assertions and Compose restart-policy assertions — PASS.

## 2026-08-25 — AI key runtime and model-selection remediation

### Defects fixed

- Audited the model/key workflow in `gemini-novel-translator-studio-restored` at
  commit `8cf7389` and retained its useful single-catalog/default-model pattern.
  The reference NVIDIA datalist/exact-ID workflow was intentionally not copied.
- Fixed the production disconnect where ADMIN-saved encrypted provider keys,
  enabled state, base URL and selected models were persisted but the running
  providers continued to use environment-only clients. Runtime clients are now
  rebuilt from database settings first, with environment values as bootstrap
  fallback, without returning or logging decrypted keys.
- Added one backend model catalog with friendly labels and recommended defaults,
  merged with live Gemini/NVIDIA discovery. Exact IDs remain configurable and
  are isolated to the configuration layer; router/business logic still has no
  vendor-specific model branch.
- Replaced the raw model-ID form with a recommended/saved model dropdown. Custom
  IDs are available only through the advanced option, and provider changes clear
  the unsaved key draft. The AI settings page is now ADMIN-gated.
- Added Gemini model discovery and moved Gemini authentication from query strings
  to the `x-goog-api-key` header.
- Docker Compose now passes AI bootstrap configuration to the API. `start.bat`
  creates a separate 32-byte `SECRET_ENCRYPTION_KEY` for new LOCAL installs and
  safely adds only that missing key to the validated legacy LOCAL contract.

### Acceptance evidence

- Workspace typecheck — PASS.
- ESLint with zero warnings and Prettier/diff checks — PASS.
- Unit suite — PASS: 86 files / 474 tests, including encrypted DB-key runtime,
  provider disablement/default selection, Gemini header/discovery, catalog,
  schema and UI provider-switch/custom-model coverage.
- Production build — PASS; `/settings/ai` included.
- Browser QA against a local non-secret mock API — PASS: Gemini and NVIDIA
  recommended models were preselected, friendly labels/ID details rendered,
  key drafts were cleared on provider switch and custom-model input appeared
  only after selecting the advanced option.
- `docker compose config --quiet` — PASS with an isolated validation environment.
  Docker daemon/provider-key live smoke remains owner-run because Docker Desktop
  was not running and no real provider secret was used during this remediation.

### Boundaries preserved

- Provider secrets remain AES-256-GCM encrypted at rest and browser responses
  contain only masked values. No secret was copied from the reference project.
- Curated model IDs are configuration metadata, not routing/business logic;
  provider discovery and custom IDs remain available.
- AI remains optional and cannot modify canonical YouTube data or stop collectors,
  dashboard, rankings or health collection paths.

## 2026-08-25 — Prebuilt startup and monitoring-dashboard remediation

### Defects fixed

- Fixed API bootstrap with blank optional Gemini/NVIDIA URL or model values from
  Compose. Fatal startup logs now expose only the error type and sanitized Zod
  field paths/codes, never configuration values.
- Added a prebuilt five-image Compose topology and a gated GHCR workflow. Every
  service uses the same immutable commit tag; moving tags are promoted only
  after the full image matrix succeeds.
- Split first setup/repair (`setup.bat`) from normal startup (`start.bat`). The
  normal path pins the checked-out Git SHA, pulls only after an update and then
  runs Compose without rebuilding. A missing setup marker returns to migration,
  identity and ADMIN verification instead of starting an unusable empty system.
- Added strict `.env` validation and process-environment isolation for Windows
  PowerShell 5.1. Ambient Compose profiles, project names, database credentials
  and provider values cannot silently override the validated LOCAL contract.
- Rebuilt the dashboard around canonical channel/video snapshots: four KPI
  cards, channel scale charts, recent/weekly video charts, data coverage, live
  ADMIN health, discovery feed and AI availability. Incomplete metric coverage
  hides totals, and health/AI failures no longer erase canonical chart data.

### Acceptance evidence

- Windows PowerShell 5.1 parser/BOM checks — PASS for all three startup scripts;
  environment set/clear/restore smoke — PASS with hostile ambient values.
- Source and prebuilt Compose validation — PASS; prebuilt API/Web/Worker/migrate/
  seed services contain immutable images and no build instructions.
- Workspace validate/generate/typecheck/lint/format/unit/build gate — PASS: 86
  files / 479 tests and all production routes.
- Clean Docker/API/Worker/Web/Playwright acceptance — PASS: six migrations, 8
  database/auth integration files / 37 tests, outage/recovery checks, browser
  flow and verified isolated-resource cleanup.
- Dashboard desktop/mobile browser QA with canonical mock snapshots — PASS; no
  horizontal overflow or browser console error. Targeted Web suite covers empty,
  partial-metric and optional-service-failure states.

### Boundaries preserved

- No PostgreSQL volume is deleted or credential rotated by startup/update paths.
- AI remains optional and cannot replace or mutate canonical metrics.
- LOCAL remains loopback-only; public hosting and proxy invariants are unchanged.
- Scheduling/report boundaries remain on the spec baseline `Asia/Bangkok`.

## 2026-08-25 — Real public metrics and 28-day dashboard panel

### Defects fixed

- Connected `ChannelStatsJob` and `DailyFinalizeJob` to the Worker lifecycle and
  replaced the null current-stats stub with a bounded public YouTube About collector.
  No HTML is persisted; unavailable fields remain null and partial collection retries
  after 15 minutes.
- Added immediate/30-second collection for unscanned channels, six-hour scheduled
  collection, local 00:10 daily finalization and restart preflight that skips every
  existing canonical daily row before making a YouTube request.
- Added an authenticated no-store 28-day trend API with signed-string BigInt values,
  exact local calendar dates, daily snapshot coverage and stale-current rejection.
- Added the dark three-metric dashboard panel requested by the owner: public view
  delta, subscriber delta and newly discovered videos. Revenue and private watch time
  are absent; neither is fabricated or substituted.
- Added explicit baseline warm-up/no-channel/error states, accessible per-day data,
  non-distorted SVG scaling, bounded fast refresh and a responsive mobile navigation
  grid.

### Acceptance evidence

- Workspace `pnpm verify` — PASS: Prisma validate/generate, typecheck, ESLint with
  zero warnings, Prettier, production build and 96 files / 515 unit tests.
- `pnpm test:integration` — PASS: clean six-migration Compose stack, 8 integration
  files / 37 tests, API/Worker/Web health, restart recovery, browser flow and cleanup.
- Isolated production Docker live probe — PASS: `@miumiutruyenaudio` resolved to its
  canonical channel and displayed 14,400 subscribers, 638 videos and 2,408,026
  lifetime views from a real saved snapshot.
- Desktop and 390×844 browser QA — PASS. The mobile document reports
  `scrollWidth = clientWidth = 375`; all KPI values and the trend warm-up panel remain
  readable without whole-page horizontal overflow.

### Boundaries preserved

- Public-only monitoring remains unchanged; no OAuth scope was added.
- Missing history is never backfilled or displayed as zero. A genuine 28-day total
  warms up from canonical daily snapshots and cannot be shown immediately on a new
  installation.
- AI remains optional and cannot write canonical YouTube metrics.

## 2026-08-26 — Public intelligence and evidence-grounded AI

### Defects fixed

- Added a typed per-channel public-intelligence API and UI panel for current public
  totals, observed 30-day deltas, actual discovered publications, signed inventory
  change, average public video duration and observed upload frequency.
- Added metric-level provenance/precision/coverage. Rounded subscribers, partial
  catalog coverage, a missing baseline and negative public corrections are labeled
  explicitly; they are never silently converted into exact private Analytics data.
- Replaced badge-only AI output with schema-validated reports whose prose claims
  cite stable deterministic evidence IDs. Unknown IDs and unsupported numeric claims
  fail validation; insufficient aggregates skip AI generation.
- Required channel/video inspection reasons to cite evidence for that same entity,
  rejected stale or reused snapshot boundaries, and anchored video windows to the
  configured local calendar. Missing six-hour boundary observations remain null and
  downgrade coverage instead of producing a synthetic zero.
- Final review remediation pins each scheduled report to its configured local
  occurrence cutoff and carries that cutoff through scheduler, pipeline, aggregate
  and fingerprint caching. Retry/restart cannot consume later snapshots or overwrite
  a successful occurrence after metadata drift; weekly reports catch up the latest
  missed occurrence. DST gaps run at the first valid later local minute, never before
  the configured wall time. Public deltas now require exact precision from both the current and
  baseline counters before they may be labeled exact; legacy baseline rows remain
  conservatively rounded, and a current snapshot older than two six-hour collection
  windows is explicitly partial.
- Target-specific AI reasons now reject evidence belonging to another channel/video
  and revalidate numeric tokens only against same-target or portfolio evidence.
  Every persisted evidence item carries precision/status/reason, while the UI keeps
  entity, provider and effective model provenance visible.
- Connected daily and weekly report scheduling to the Worker lifecycle, reloads
  encrypted database provider settings for each report run and preserves the
  Gemini/NVIDIA fallback router. Weekly reads now return the latest persisted Monday
  report on or before the requested date.
- Added visible channel-classification results and a detailed dashboard table so an
  analysis action no longer completes without showing its result.
- Displayed every cited evidence value, source, observation time and coverage/
  precision state in the report UI. Provider/model audit rows now record the actual
  routed default or fallback model; public classification metadata is explicitly
  untrusted and cannot override its prompt.
- Enforced PARTIAL coverage in code: a report must cite canonical coverage evidence
  in a limitation, and the UI always shows a deterministic PARTIAL banner. Channel
  current-total cards now use typed public-intelligence metrics with status,
  precision, captured time, reason, source and method; unavailable intelligence is
  not replaced by stale channel-header counters.

### Acceptance evidence

- Targeted public-intelligence, repository, API, grounding, scheduler and Web suites
  — PASS, including stale-boundary, cross-entity, prompt-injection, routed-model,
  fixed occurrence, weekly catch-up, PARTIAL coverage and DST regressions.
- Workspace `pnpm verify` — PASS: Prisma validate/generate, all typechecks, ESLint
  with zero warnings, Prettier, 109 files / 584 unit tests and every production
  build/route.
- Clean `pnpm test:integration` — PASS: all six migrations applied and replay-safe,
  8 PostgreSQL/auth integration files / 37 tests, API/Worker/Web health, outage and
  restart recovery, containerized Playwright acceptance and isolated cleanup.
- `pnpm audit --audit-level high` — PASS: no known vulnerabilities.
- Deliberate mutation checks reproduced all three review defects (future-window,
  baseline-precision promotion and cross-entity numeric laundering); their focused
  tests failed for the expected reason, then the restored implementation passed 7
  files / 45 tests.
- Final scoped-review regressions also failed first for post-cutoff fingerprint drift
  and a nonexistent DST wall time, then passed after occurrence-keyed caching and
  timezone-safe resolution were implemented.
- Windows PowerShell parser/environment-isolation and both Compose configuration
  contracts — PASS without exposing LOCAL secrets. Ambient AI schedule variables are
  cleared around Compose and restored afterward.

### Boundaries preserved

- No vidIQ endpoint, package, cookie, browser session or scraper was introduced.
- No Google login, YouTube Analytics private scope, revenue or watch-time estimate
  was added. Public-only metrics and locally observed snapshots remain the source of
  truth.
- AI cannot collect, overwrite, interpolate or rank canonical metrics. Collected
  titles/descriptions/tags are untrusted data and cannot instruct the model.

## 2026-08-26 — Phase 11 groups, scoped VIEWER access and honest partial metrics

### Delivered behavior

- Added `ChannelGroup`, `ChannelGroupChannel` and `UserChannelGroup` with indexed
  many-to-many membership, atomic replacement repositories and upgrade-safe
  compatibility-group backfill for existing VIEWER accounts and active channels.
- Added audited ADMIN APIs and UI for group create/edit/archive, complete channel
  replacement, and complete one-or-many group assignment for each VIEWER. An
  explicit empty assignment is deny-all and is shown as `Không có quyền xem kênh`.
- Applied the effective channel scope at server/service/repository boundaries for
  channel list/detail, public intelligence, health, dashboard, videos, snapshots
  and rankings. ADMIN remains unrestricted; out-of-scope direct IDs return 404.
  Global AI reports and sync-run inspection remain ADMIN-only.
- Kept strict totals and per-day values `NULL` until coverage is complete, while
  adding typed observed values with covered/total/status so partial timelines are
  useful and visibly qualified. Negative public corrections remain signed.
- Distinguished exact public YouTube `No subscribers`/`0 subscribers` from a
  missing counter. Dashboard totals use a labelled known lower bound; per-channel
  `0* · chưa xác minh` is presentation-only and never becomes canonical zero.
- Updated the Windows/Docker documentation: `git pull --ff-only` updates source,
  `start.bat` starts the checked-out commit, and Docker Desktop Play only restarts
  the already-installed version.

### Acceptance evidence

- Focused group UI gate — PASS: 4 files / 34 tests covering typed full-array PUTs
  (including `[]`), ADMIN-only navigation, group CRUD/channel replacement,
  multi-group VIEWER creation/editing and assignment-failure recovery.
- Workspace `pnpm verify` — PASS: Prisma validate/generate, all typechecks, ESLint
  with zero warnings, Prettier, 117 files / 654 unit tests and every production
  build, including `/channel-groups`.
- Fresh `pnpm test:integration` — PASS: eight migrations clean/replay-safe, 11
  PostgreSQL integration files / 45 tests, real union/dedup and zero-group scope,
  same-session membership changes, API/Worker/Web/PostgreSQL outage recovery,
  updated group-scoped Playwright acceptance and isolated resource cleanup.
- The first browser run correctly exposed a stale pre-Phase-11 success-message
  assertion. The E2E flow was updated to prove ADMIN group navigation, explicit
  empty assignment and hidden VIEWER group controls; the clean rerun passed.

### Boundaries preserved

- Missing canonical counters remain `NULL`; no history, subscriber count or daily
  baseline is fabricated.
- AI remains an optional evidence explanation layer and cannot write canonical
  metrics. No vidIQ endpoint, package, cookie, Google login, revenue or private
  Analytics scope was introduced.
- UI hiding is not an authorization boundary; all scoped reads and group writes are
  enforced by authenticated server code and covered by PostgreSQL tests.

## 2026-08-26 — Dashboard group/channel scope selectors

### Delivered behavior

- Added a group selector above the dashboard KPI cards using only the actor's
  accessible groups, plus a channel selector whose default is every channel in the
  selected group. Changing groups safely resets the selected channel.
- Applied the same server-authoritative `groupId`/`channelId` selection to channel
  KPIs, the 28-day timeline, recent videos and rolling seven-day rankings. Empty
  groups remain empty; explicit missing, archived, unauthorized and mismatched
  selections return the same not-found response.
- Loaded every channel-option page instead of truncating at 100 entries. VIEWER
  scope is the deduplicated union of assigned active groups; ADMIN remains
  unrestricted when no explicit filter is selected.
- Serialized dashboard polling so a slow request cannot cause overlapping batches
  or permanent loading. Warm-up is bounded independently, scope changes abort old
  work, and stale responses cannot overwrite newer data.
- If a selected group or channel is revoked during the session, canonical data is
  cleared and the closest valid server-authoritative scope is reloaded. Other poll
  failures retain last-known data but visibly mark the affected surfaces stale.
- Kept global health and AI surfaces explicitly ADMIN/global; no canonical metric,
  missing subscriber value or AI/data-source invariant was changed.

### Acceptance evidence

- Workspace `pnpm verify` — PASS: Prisma validate/generate, all typechecks, ESLint,
  Prettier, 117 files / 688 unit tests and every production build/route.
- Focused scope suites — PASS: 17 Web files / 92 tests and 12 API files / 89 tests,
  including 10-second warm-up, 60-second refresh, scoped pagination, empty groups,
  slow batches and group/channel revocation.
- PostgreSQL scope integration — PASS: all eight migrations clean/replay-safe,
  11 files / 47 tests, valid composite group/channel selection, active unassigned
  group denial and one 404 shape across all four dashboard sources.
- Full `pnpm test:integration` — PASS: Docker images, API/Worker/Web health,
  outage/restart recovery, browser/Playwright acceptance and isolated cleanup.
- `pnpm audit --audit-level high` — PASS: no known vulnerabilities. Diff secret scan
  and `git diff --check` — PASS.

### Boundaries preserved

- Missing canonical counters remain `NULL`; the UI does not serialize display
  fallback values as observed facts or fabricate timeline baselines.
- AI remains an explanation layer and cannot collect, alter or rank canonical
  metrics. No Google login, vidIQ endpoint/cookie/scraper, revenue estimate or
  private YouTube Analytics scope was introduced.
