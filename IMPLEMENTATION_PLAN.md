# YouTube Home Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng từ đầu một hệ thống riêng tư theo dõi nhiều kênh YouTube công khai, lưu lịch sử deterministic tại máy chủ gia đình, tính ranking cục bộ và bổ sung phân tích AI tùy chọn mà không để AI trở thành nguồn dữ liệu.

**Architecture:** Monorepo pnpm gồm Next.js Web, NestJS REST API, NestJS Worker và các package có ranh giới rõ; PostgreSQL/Prisma là nguồn dữ liệu trung tâm. Worker thu thập dữ liệu công khai và ghi snapshot idempotent, analytics đọc snapshot để tính toán deterministic, AI chỉ nhận aggregate đã kiểm chứng, còn Web truy cập API cùng origin qua reverse proxy.

**Tech Stack:** Node.js 24 LTS, pnpm 11, TypeScript strict, Next.js 16/React 19, NestJS 11, PostgreSQL 18, Prisma 7, Zod, Pino, Vitest, Playwright, yt-dlp, Docker Compose, Caddy và Cloudflare Tunnel.

**Spec:** `C:\Users\Duongvh-pc\Downloads\YOUTUBE_HOME_MONITOR_AI_SPEC.md` — đã đọc đủ 3.843 dòng/131 mục ngày 2026-08-21.

## Global Constraints

- Server là source of truth; raw metrics và mọi ranking chuẩn phải deterministic.
- AI chỉ phân loại/giải thích/tóm tắt; AI không thu thập hoặc ghi raw metrics, không tính canonical totals, không quyết định ranking chuẩn hoặc xóa kênh một mình.
- Không có dependency vào MCP, vidIQ backend, YouTube OAuth, Google Login, private YouTube Studio, CAPTCHA bypass hoặc anti-bot bypass.
- `CHANNEL URL → CANONICAL CHANNEL ID`; không tạo Channel khi chưa có canonical ID.
- `TEMPORARY FAILURE != DELETED CHANNEL`; xóa/terminated cần bằng chứng xác nhận theo thời gian và mass-failure protection.
- `TOP 10 WEEK = ROLLING 7-DAY VIEW GAIN`.
- `HOT NOW = LOCAL VIEW VELOCITY`.
- `BREAKOUT = PERFORMANCE VS SAME-CHANNEL BASELINE`.
- `SERVER SNAPSHOTS = HISTORICAL SOURCE OF TRUTH`; không backfill lịch sử giả.
- Giá trị thiếu giữ `NULL`, không đổi thành `0`; correction âm được giữ nguyên; không nội suy ngầm.
- Scheduled writes idempotent; mỗi metric có source và timestamp.
- AI tùy chọn ở runtime; lỗi Gemini/NVIDIA không được làm dừng collector, health hoặc raw dashboard.
- Mọi AI output được code sử dụng phải qua structured schema validation.
- Provider/model ID là configuration, không nằm trong business logic.
- ADMIN tạo user; VIEWER chỉ đọc; không public signup.
- Public Internet luôn yêu cầu login; PostgreSQL, Worker, Docker daemon, Playwright debug port và internal API không được public.
- UI dùng tiếng Việt; scheduling dùng timezone cấu hình, baseline giữ `APP_TIMEZONE=Asia/Bangkok` như spec.
- Package manager là pnpm; TypeScript bật `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` và `useUnknownInCatchVariables`.
- Sau mỗi phase bắt buộc chạy `pnpm typecheck`, `pnpm lint`, `pnpm test` và test gate riêng của phase.
- Không thay đổi bất kỳ critical invariant nào ở trên nếu chưa có chấp thuận trực tiếp của chủ dự án.

---

## 1. Phân biệt nguồn chỉ dẫn và phạm vi được phép thực hiện

Yêu cầu trực tiếp của chủ dự án điều khiển workflow hiện tại: đọc toàn bộ spec, tạo file kế hoạch này, chia phase/workstream, audit dependency/assumption, triển khai tuần tự các phase được chủ dự án tiếp tục chấp thuận, chạy quality gates sau mỗi phase và hỏi trước khi đổi critical invariant.

Nội dung trong spec là product/technical requirements. Mục “FINAL COMMAND TO CODEX” trong tài liệu không tự mở rộng quyền thực hiện sang toàn bộ Phase 1–10. Phase 0 được chủ dự án tiếp tục giao; Phase 1 chỉ được đánh dấu hoàn tất sau evidence và review độc lập của các gate bên dưới. Các phase sau vẫn cần quyết định tiếp nối.

Repository root được chọn là `D:\Codex project`; cây `youtube-home-monitor/` trong spec được hiểu là cây tương đối từ root này, không tạo thêm một thư mục lồng cùng tên.

## 2. Dependency audit và version baseline

### 2.1 Đã xác nhận trên máy

| Dependency     | Trạng thái ngày 2026-08-21                                                 | Kết luận                                                                                 |
| -------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Windows        | Windows 11 Pro x64, build 26200                                            | Đạt target Windows 10/11                                                                 |
| PowerShell     | 7.6.4                                                                      | Dùng cho scripts vận hành                                                                |
| Git            | 2.51.0.windows.1; name/email đã cấu hình                                   | Phase 0 sẽ `git init`                                                                    |
| Workspace      | Trống, chưa có `.git`                                                      | Đúng greenfield                                                                          |
| Node.js        | 24.16.0 x64                                                                | Đạt baseline Node 24                                                                     |
| Corepack       | 0.35.0                                                                     | Dùng để gọi pnpm đã pin                                                                  |
| pnpm           | 11.19.0 chạy trong runtime Codex; chưa có shim host thông thường           | Pin `pnpm@11.22.0`; mọi lệnh tài liệu dùng `corepack pnpm` khi `pnpm` không có trên PATH |
| Docker Desktop | 4.45.0, đang chạy                                                          | Không có blocker Phase 0                                                                 |
| Docker Engine  | 28.3.3 Linux/WSL2, 16 CPU, khoảng 23,4 GiB RAM                             | Đủ cho stack ban đầu                                                                     |
| Docker Compose | 2.39.2                                                                     | Hỗ trợ health dependency và one-shot migration                                           |
| WSL            | 2.5.9.0, kernel 6.6.87.2                                                   | Chỉ làm Docker backend; không cần distro Linux riêng                                     |
| Ports          | 3000, 5000, 5432, 8080 không có listener và không nằm trong excluded range | Khả dụng theo quan sát; bind test diễn ra trong Phase 0                                  |

### 2.2 Version được pin khi bắt đầu Phase 0

| Thành phần         | Version/policy                                 | Căn cứ                                                                                       |
| ------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Node               | `>=24 <25`; image `node:24.19.0-bookworm-slim` | Node 24 LTS; host 24.16 vẫn nằm trong range                                                  |
| pnpm               | `11.22.0` trong `packageManager`               | Bản stable hiện hành; Node 24 được hỗ trợ                                                    |
| TypeScript         | `5.9.3`                                        | Tương thích peer range hiện hành của `typescript-eslint`; không lấy TS 7 chỉ vì tag `latest` |
| Next.js            | `16.3.2`                                       | Stable registry tại thời điểm lập kế hoạch                                                   |
| React/React DOM    | `19.2.8`                                       | Peer-compatible với Next.js đã pin                                                           |
| NestJS             | `11.2.1`                                       | Stable registry; yêu cầu Node >=20                                                           |
| Prisma packages    | `7.9.1`                                        | Stable GA; dùng `@prisma/adapter-pg` bắt buộc của Prisma 7                                   |
| PostgreSQL         | `postgres:18.4-bookworm`                       | Official image exact tag; volume mount theo layout PostgreSQL 18                             |
| ESLint             | `10.9.0`                                       | Được `typescript-eslint@8.67.0` hỗ trợ                                                       |
| typescript-eslint  | `8.67.0`                                       | Peer TypeScript `>=4.8.4 <6.1.0`                                                             |
| Vitest             | `4.1.11`                                       | Unit/integration test runner chung                                                           |
| Zod                | `4.4.3`                                        | Runtime schema validation                                                                    |
| Pino / nestjs-pino | `10.3.1` / `4.6.1`                             | Structured logging/redaction                                                                 |

Nguồn compatibility chính: [Node releases](https://nodejs.org/en/about/previous-releases), [pnpm installation/compatibility](https://pnpm.io/installation), [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [NestJS prerequisites](https://docs.nestjs.com/first-steps), [Prisma requirements](https://docs.prisma.io/docs/orm/reference/system-requirements), [Docker Desktop Windows requirements](https://docs.docker.com/desktop/setup/install/windows-install/).

`pnpm-lock.yaml` là nguồn pin transitive dependency. Không dùng `latest`, `next`, RC hoặc range caret/tilde trong manifest đã commit.

### 2.3 Dependency chưa cần ở Phase 0

- Phase 1: Argon2id, CSRF/session/rate-limit dependencies và secret material.
- Phase 2: yt-dlp binary, RSS parser và public YouTube network smoke.
- Phase 3: Playwright Chromium image/dependencies.
- Phase 6: Gemini key, Google GenAI SDK và `SECRET_ENCRYPTION_KEY` thật.
- Phase 7: NVIDIA key/base URL và danh sách model do provider trả về.
- Phase 8: shadcn/ui, TanStack Query/Table, Recharts, React Hook Form.
- Phase 9: domain, Cloudflare Tunnel token, public DNS, Caddy và mobile-network test.
- Phase 10: vị trí backup, retention capacity và reboot/startup policy.

### 2.4 Assumptions cần được biến thành evidence

- Registry/package download và Docker image pull chưa được chứng minh; `pnpm install --frozen-lockfile` và Docker build trong Phase 0 là gate xác minh.
- Các cổng mới chỉ được quan sát là trống; Compose bind trên loopback là gate xác minh.
- Docker Desktop tự khởi động và phục hồi stack sau host reboot chưa được thử; việc này thuộc L015/Phase 10.
- Phase 0 chỉ chứng minh Worker nối đúng egress bridge; trước Phase 2 phải đặt
  explicit gateway priority và chạy bounded DNS/outbound smoke cho collector.
- Next rewrite được bake với `http://api:5000` và Compose runtime dùng đúng giá
  trị đó. Nếu topology cần URL runtime khác, phải chuyển proxy sang runtime path
  thay vì giả định biến runtime sẽ đổi manifest đã build.
- Domain, DNS, tunnel token và khả năng test bằng mobile network chưa có trong workspace; Phase 9 không được tự tạo hoặc thay đổi external state nếu chưa nhận thông tin/quyền tương ứng.
- Gemini/NVIDIA key không cần để core stack chạy; Phase 6/7 sẽ kiểm thử cả trường hợp không cấu hình key.

### 2.5 Supply-chain audit và residual risk

- `corepack pnpm audit --prod` ngày 2026-08-21 báo đúng một advisory mức high:
  `GHSA-ggr8-5vv4-36mx` trong `deepmerge-ts@7.1.5`, đi qua
  `prisma@7.9.1 -> @prisma/config`.
- Bản vá upstream chỉ có ở `deepmerge-ts>=8`; Prisma 7.9.1 đang pin nhánh 7.x.
  Không ép override major transitive dependency ngoài support matrix chỉ để làm
  audit xanh.
- Current code chỉ dùng đường dẫn này khi Prisma CLI/config xử lý cấu hình tĩnh do
  repository sở hữu, không merge graph do request hoặc collector cung cấp. Vì
  vậy exploitability của Phase 0 được đánh giá thấp nhưng advisory vẫn là
  residual risk, không được mô tả là đã sửa.
- pnpm áp dụng `minimumReleaseAge: 1440` (24 giờ) cùng allowlist version hữu hạn;
  exact direct pins và frozen lockfile vẫn là gate bắt buộc. Cấu hình này đã được
  chứng minh bằng một lần `install --frozen-lockfile` sau khi bật policy.
- Theo dõi Prisma release có dependency đã vá và nâng cấp sau khi chạy lại toàn bộ
  schema/generate/migration/integration gates. Production-minimal runtime image
  không kế thừa build tooling là hardening follow-up, muộn nhất ở Phase 10.

## 3. Assumptions và quyết định làm rõ spec

Các quyết định dưới đây không thay đổi critical invariant. Nếu bằng chứng triển khai cho thấy một quyết định va chạm invariant, công việc dừng trước thay đổi và xin ý kiến chủ dự án.

| Chủ đề                   | Quyết định kế hoạch                                                                                                                                                      | Phase xác minh |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| RSS cadence              | Dùng default `RSS_SCAN_MINUTES=15` từ §53/§87; vẫn configurable. Mốc 60 phút ở §19 được coi là mô tả cũ hơn.                                                             | 2              |
| Playwright ở Phase 2/3   | Phase 2 có lát cắt tối thiểu để verify/fallback canonical resolution theo §8; Phase 3 sở hữu parser health và deletion safety đầy đủ.                                    | 2–3            |
| Daily canonical snapshot | Job 00:10 thực hiện fresh collection. Nếu collection thất bại, ngày đó là `PARTIAL` hoặc thiếu; không lấy snapshot ngoài ngày, không nội suy.                            | 2              |
| Pending deletion         | Lần strong not-found đầu giữ last-known availability và lưu pending evidence/counter; không thêm `PENDING_CONFIRMATION` vào availability enum và không đánh dấu deleted. | 3              |
| Deletion confirmation    | Cần initial strong failure, retry sau 30 phút và ít nhất một temporal confirmation strong ở check kế tiếp; incident/circuit-breaker khóa mọi transition deleted.         | 3              |
| Weekly baseline          | Baseline hợp lệ là snapshot gần nhất tại hoặc trước `now-7d`, không cũ hơn 6 giờ; không có baseline hợp lệ thì `WARMING_UP`.                                             | 5              |
| Hot Now ordering         | Default sort là raw `local_vph_1h DESC`; smoothed 70/30 chỉ là mode configurable và luôn hiển thị raw VPH 1h/3h.                                                         | 5              |
| Breakout sample          | Tối đa 50 video gần nhất, cần ít nhất 20 comparable; median 0 hoặc sample thiếu trả `NULL/INSUFFICIENT_BASELINE`, không trả infinity.                                    | 5              |
| Metric provenance        | `source_details/source_summary` là map theo metric `{source, capturedAt}`; row-level source không được che mất provenance của metric hợp nhất.                           | 2              |
| AI role names            | Domain enum dùng `FAST`, `ANALYSIS`, `LONG_CONTEXT`, `FALLBACK`; tên env có hậu tố `_MODEL` chỉ là adapter config.                                                       | 6–7            |
| AI result persistence    | Lưu validated result riêng khỏi raw snapshot; `ai_runs` giữ metadata/fingerprint/status, payload retention theo setting.                                                 | 6              |
| Channel/user DELETE      | API `DELETE` thực hiện archive/disable có audit; hard delete không được public API cung cấp.                                                                             | 1–2            |
| VIEWER-triggered AI      | Default tắt; chỉ cho phép khi ADMIN bật setting riêng, nhưng hành động không được ghi raw data.                                                                          | 7              |
| Timezone                 | Giữ default `Asia/Bangkok` đúng `.env` spec; mọi boundary test dùng timezone này.                                                                                        | 0, 2           |
| UI phase ownership       | Phase 1 có login/user slice tối thiểu, Phase 2 có add-channel slice tối thiểu; Phase 8 hoàn thiện toàn bộ J workstream/UX.                                               | 1–2, 8         |

## 4. File ownership và package boundaries

```text
apps/web       Vietnamese UI, browser routes, same-origin API access
apps/api       REST /api/v1, authz, DTO validation, orchestration, health
apps/worker    schedules, collectors, reconciliation, reports, heartbeat
packages/db    Prisma client/repositories/transactions/advisory locks
packages/shared deterministic contracts, enums, errors and health schemas
packages/config Zod environment/config parsing
packages/collectors/youtube-rss RSS-only acquisition
packages/collectors/ytdlp controlled metadata-only subprocess
packages/collectors/youtube-public anonymous Playwright public-page parser
packages/analytics pure deterministic delta/VPH/ranking/breakout functions
packages/ai       provider contracts, Gemini/NVIDIA adapters and router
packages/auth     password/session/CSRF/authorization primitives
packages/crypto   AES-256-GCM key wrapping and masking
packages/ui       shared presentational components/tokens
prisma            schema, incremental migrations and seed entrypoint
scripts           PowerShell verification, backup/restore and host health
docs              architecture, data, ranking, AI, deployment and testing
```

Ranh giới dependency:

```text
web -> shared, config, ui
api -> shared, config, db, auth, crypto, analytics, ai
worker -> shared, config, db, collectors, analytics, ai
ai -> shared, config, crypto
collectors -> shared, config
analytics -> shared only
db -> generated Prisma client + PostgreSQL adapter
```

`analytics` không import `ai`; collector không import provider AI; raw repository không nhận AI result type. Đây là enforcement kiến trúc của `AI != DATA SOURCE`.

## 5. Phase/workstream crosswalk

| Phase | Workstream/task IDs                                                                                                  | Deliverable và exit gate                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 0     | A001–A013; B001, B011, B016; K009; L001–L003 foundation slice                                                        | Foundation + Docker + DB boot; Web/API/Worker/Postgres healthy |
| 1     | B002, B003, B012, B017; C001–C013; J001/J018 minimum slice; L010 cookie baseline                                     | Auth + Users; Admin + Viewer security works                    |
| 2     | B004–B006, B010; D001–D013; D014–D017 minimum resolve slice; K001–K004, K007, K010; L004–L005; J004 minimum add form | URL/handle tạo Channel canonical qua public sources            |
| 3     | B009; D014–D023 completion; E001–E011; K005                                                                          | Public health không false delete                               |
| 4     | B007–B008; F001–F007, F018 candidate part; K006, K008                                                                | Candidate video và snapshot được theo dõi idempotent           |
| 5     | F008–F019 completion; B015 ranking indexes                                                                           | Top Week, Hot Now, Breakout deterministic                      |
| 6     | B013–B014; G001–G011; I001, I004–I010                                                                                | Gemini structured reports, cache và no-AI mode                 |
| 7     | H001–H010; I002–I004 routing completion                                                                              | NVIDIA discovery/fallback/deep roles hoạt động                 |
| 8     | J001–J023 completion; server pagination APIs                                                                         | Dashboard tiếng Việt đầy đủ, freshness/coverage/UX states      |
| 9     | L001–L012 production completion                                                                                      | LAN + Caddy + Cloudflare Tunnel + public security              |
| 10    | L013–L016; final B015/B016 audit; retention/performance/security hardening                                           | Full acceptance, backup/restore và final verification          |
| 11    | Group schema/API/UI; access-scope remediation; partial metric contracts                                              | Multi-group VIEWER scope và honest partial dashboard           |

Migrations và indexes được thêm cùng owning phase; không thiết kế toàn bộ schema sớm rồi để các cột không có semantics.

---

## 6. Phase 0 — Detailed execution plan

**Execution result (2026-08-21):** Tasks 0.1–0.8 passed the clean local and
isolated Docker gates recorded in `WORKLOG.md`. Because this was an unborn
greenfield repository developed through parallel independent workstreams, the
per-task commit checkpoints below were consolidated into one verified initial
Phase 0 commit; no test or scope checkpoint was skipped.

### Task 0.1: Initialize repository và pin toolchain

**Files:**

- Create: `.gitignore`, `.dockerignore`, `.editorconfig`, `.node-version`, `.npmrc`
- Create: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- Create: `README.md`, `WORKLOG.md`

**Interfaces:**

- Produces: workspace package names `@yt-monitor/web`, `@yt-monitor/api`, `@yt-monitor/worker`, `@yt-monitor/config`, `@yt-monitor/shared`, `@yt-monitor/db`.
- Produces: root commands `build`, `typecheck`, `lint`, `format:check`, `test`, `test:unit`, `test:integration`, `verify`, `verify:phase0`.

- [x] **Step 1: Initialize Git only in the validated workspace root**

Run:

```powershell
git rev-parse --show-toplevel
git init --initial-branch=phase/0-foundation
git status --short --branch
```

Expected: first command confirms no existing repo; `git init` creates `D:\Codex project\.git`; implementation starts on `phase/0-foundation`, not `main`.

- [x] **Step 2: Add toolchain manifests with exact pins**

Root `package.json` scripts:

```json
{
  "private": true,
  "engines": { "node": ">=24 <25" },
  "packageManager": "pnpm@11.22.0",
  "scripts": {
    "build": "pnpm -r --if-present build",
    "typecheck": "pnpm -r --if-present typecheck",
    "lint": "eslint . --max-warnings=0",
    "format": "prettier . --write",
    "format:check": "prettier . --check",
    "test": "pnpm test:unit",
    "test:unit": "vitest run",
    "test:integration": "pwsh -NoProfile -File scripts/test-phase0-docker.ps1",
    "db:generate": "prisma generate",
    "db:migrate:deploy": "prisma migrate deploy",
    "verify": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build",
    "verify:phase0": "pnpm verify && pnpm test:integration"
  }
}
```

Workspace globs:

```yaml
packages:
  - apps/*
  - packages/*
```

- [x] **Step 3: Install from registry and freeze the graph**

Run:

```powershell
corepack pnpm install
corepack pnpm install --frozen-lockfile
```

Expected: both succeed; committed manifests contain exact direct versions; lockfile is present.

- [x] **Step 4: Commit the repository/toolchain unit**

```powershell
git add .gitignore .dockerignore .editorconfig .node-version .npmrc package.json pnpm-workspace.yaml pnpm-lock.yaml README.md WORKLOG.md IMPLEMENTATION_PLAN.md
git commit -m "chore: initialize monitoring monorepo"
```

### Task 0.2: Strict TypeScript, ESLint, Prettier và Vitest baseline

**Files:**

- Create: `tsconfig.base.json`, `tsconfig.json`
- Create: `eslint.config.mjs`, `prettier.config.mjs`, `vitest.config.ts`
- Create: `tests/types/strictness.ts`

**Interfaces:**

- Produces: shared compiler contract consumed by every app/package.
- Produces: a single zero-warning lint rule set and one Vitest runner.

- [x] **Step 1: Write a compile-time fixture that must reject unsafe indexing and optional-property misuse**

```ts
// @ts-expect-error noUncheckedIndexedAccess requires an undefined guard
const value: string = ["safe"][1];

// @ts-expect-error exactOptionalPropertyTypes rejects explicit undefined
const option: { label?: string } = { label: undefined };
```

- [x] **Step 2: Run typecheck and confirm the fixture fails before strict flags exist**

Run: `corepack pnpm typecheck`

Expected: FAIL because the `@ts-expect-error` directives are unused or workspace configs do not exist.

- [x] **Step 3: Add the strict compiler and quality configuration**

The base config includes:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

- [x] **Step 4: Run quality commands**

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
```

Expected: PASS with zero lint warnings.

- [x] **Step 5: Commit the quality baseline**

```powershell
git add tsconfig.base.json tsconfig.json eslint.config.mjs prettier.config.mjs vitest.config.ts tests/types/strictness.ts
git commit -m "chore: enforce strict TypeScript quality gates"
```

### Task 0.3: Environment validation, health contract và secret-safe logging

**Files:**

- Create: `.env.example`
- Create: `packages/config/package.json`, `packages/config/tsconfig.json`
- Create: `packages/config/src/base-env.ts`, `api-env.ts`, `worker-env.ts`, `web-env.ts`, `index.ts`
- Test: `packages/config/src/env.spec.ts`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/health/health-contract.ts`, `packages/shared/src/logging/pino-options.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/health/health-contract.spec.ts`, `packages/shared/src/logging/pino-options.spec.ts`

**Interfaces:**

- Produces: `parseApiEnv(input)`, `parseWorkerEnv(input)`, `parseWebEnv(input)`; invalid required values throw before app boot.
- Produces: `HealthResponseSchema` and inferred `HealthResponse`.
- Produces: `createPinoOptions(service)` with redaction for password, cookies, authorization and every key/secret field.

- [x] **Step 1: Write failing env tests**

```ts
expect(() => parseApiEnv({ API_PORT: "not-a-port" })).toThrow();
expect(parseWorkerEnv({ DATABASE_URL: "postgresql://u:p@db:5432/app" }).APP_TIMEZONE).toBe(
  "Asia/Bangkok",
);
expect(
  parseWorkerEnv({ DATABASE_URL: "postgresql://u:p@db:5432/app" }).GEMINI_API_KEY,
).toBeUndefined();
```

- [x] **Step 2: Run tests and verify failure**

Run: `corepack pnpm vitest run packages/config/src/env.spec.ts`

Expected: FAIL because parsers are absent.

- [x] **Step 3: Implement exact health response contract**

```ts
type HealthStatus = "ok" | "degraded" | "unavailable" | "disabled";

interface HealthCheck {
  status: HealthStatus;
  required: boolean;
  latencyMs?: number;
  observedAt?: string;
  code?: string;
  details?: Record<string, string | number | boolean | null>;
}

interface HealthResponse {
  status: HealthStatus;
  service: "web" | "api" | "database" | "worker" | "collectors" | "ai";
  version: string;
  timestamp: string;
  checks: Record<string, HealthCheck>;
}
```

Rules: status `unavailable` của required dependency trả HTTP 503; `ok`, `degraded`, optional `disabled` trả 200; response luôn `Cache-Control: no-store`; không trả exception text, SQL, connection string, secret hoặc filesystem path.

- [x] **Step 4: Implement and test logging redaction**

Redact paths at minimum:

```text
password
req.headers.authorization
req.headers.cookie
res.headers.set-cookie
SESSION_SECRET
SECRET_ENCRYPTION_KEY
GEMINI_API_KEY
NVIDIA_API_KEY
*.apiKey
*.token
```

Test serializes a log object containing marker `PHASE0_SECRET_MARKER` and asserts the marker is absent while `[Redacted]` is present.

- [x] **Step 5: Run package gates and commit**

```powershell
corepack pnpm --filter @yt-monitor/config typecheck
corepack pnpm --filter @yt-monitor/shared typecheck
corepack pnpm vitest run packages/config packages/shared
git add .env.example packages/config packages/shared
git commit -m "feat: add validated config and health contracts"
```

### Task 0.4: Prisma 7, PostgreSQL health và idempotent worker heartbeat

**Files:**

- Create: `prisma.config.ts`, `prisma/schema.prisma`
- Create: `prisma/migrations/20260821000000_phase0_foundation/migration.sql`
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`
- Create: `packages/db/src/client.ts`, `health.repository.ts`, `heartbeat.repository.ts`, `index.ts`
- Test: `packages/db/src/heartbeat.repository.spec.ts`

**Interfaces:**

- Produces: `createPrismaClient(databaseUrl): PrismaClient` using `PrismaPg` adapter.
- Produces: `pingDatabase(): Promise<{ latencyMs: number }>` using `SELECT 1`.
- Produces: `upsertHeartbeat(input: { workerId: string; version: string; status: "RUNNING" }): Promise<void>` using PostgreSQL time.
- Produces: `getFreshestRunningHeartbeat(maxAgeSeconds: number): Promise<WorkerHeartbeat | null>`.

- [x] **Step 1: Write failing heartbeat tests**

```ts
await repository.upsertHeartbeat({ workerId: "worker-a", version: "0.1.0", status: "RUNNING" });
await repository.upsertHeartbeat({ workerId: "worker-a", version: "0.1.0", status: "RUNNING" });
expect(database.execute).toHaveBeenCalledTimes(2);
expect(database.execute).toHaveBeenLastCalledWith(
  expect.objectContaining({ workerId: "worker-a", status: "RUNNING" }),
);
```

- [x] **Step 2: Run the targeted test and verify failure**

Run: `corepack pnpm vitest run packages/db/src/heartbeat.repository.spec.ts`

Expected: FAIL because schema/repository is absent.

- [x] **Step 3: Add the only Phase 0 application model**

```prisma
model WorkerHeartbeat {
  workerId   String   @id @map("worker_id") @db.VarChar(128)
  version    String   @db.VarChar(64)
  lastSeenAt DateTime @map("last_seen_at") @db.Timestamptz(3)
  status     String   @db.VarChar(32)

  @@index([lastSeenAt(sort: Desc)], map: "worker_heartbeats_last_seen_at_idx")
  @@map("worker_heartbeats")
}
```

The upsert uses `CURRENT_TIMESTAMP` from PostgreSQL. No user/channel/video/AI table is created in this phase.

- [x] **Step 4: Validate schema, generate client and run repository unit tests**

```powershell
corepack pnpm db:generate
corepack pnpm exec prisma validate
corepack pnpm vitest run packages/db
```

Expected: schema/generation pass; the repository uses a parameterized idempotent upsert and queries freshness against PostgreSQL time. Actual migration replay and one-row proof run against Postgres in Task 0.8.

- [x] **Step 5: Commit the database foundation**

```powershell
git add prisma.config.ts prisma packages/db
git commit -m "feat: add database foundation and worker heartbeat"
```

### Task 0.5: NestJS API health endpoints

**Files:**

- Create: `apps/api/package.json`, `nest-cli.json`, `tsconfig.json`, `tsconfig.build.json`
- Create: `apps/api/src/main.ts`, `app.module.ts`
- Create: `apps/api/src/health/health.controller.ts`, `health.service.ts`
- Test: `apps/api/src/health/health.service.spec.ts`, `apps/api/src/health/health.e2e-spec.ts`

**Interfaces:**

- Produces: `GET /api/v1/health`, `/health/db`, `/health/worker`, `/health/collectors`, `/health/ai`.
- Consumes: DB ping and heartbeat freshness from `@yt-monitor/db`.
- Aggregate health requires DB and worker; collectors/AI return `disabled`, `required:false`, code `PHASE_NOT_ENABLED`/`AI_DISABLED` in Phase 0.

- [x] **Step 1: Write failing service/controller tests**

Test matrix:

```ts
it("returns 200 when database and worker are healthy");
it("returns 503 when database is unavailable");
it("returns 503 when newest worker heartbeat is older than 45 seconds");
it("reports collectors and AI as disabled, not healthy");
it("never includes raw dependency errors in the response");
```

- [x] **Step 2: Run tests and verify failure**

Run: `corepack pnpm vitest run apps/api/src/health`

Expected: FAIL because API app/health module is absent.

- [x] **Step 3: Implement minimal API boot and health aggregation**

`main.ts` sets prefix `/api/v1`, enables shutdown hooks, validated config, structured logger and port `5000` default. Detailed errors are logged only after redaction; public response uses stable codes.

- [x] **Step 4: Run API gates and commit**

```powershell
corepack pnpm --filter @yt-monitor/api typecheck
corepack pnpm vitest run apps/api
corepack pnpm --filter @yt-monitor/api build
git add apps/api
git commit -m "feat: expose foundational API health checks"
```

### Task 0.6: NestJS Worker application context và heartbeat healthcheck

**Files:**

- Create: `apps/worker/package.json`, `nest-cli.json`, `tsconfig.json`, `tsconfig.build.json`
- Create: `apps/worker/src/main.ts`, `app.module.ts`
- Create: `apps/worker/src/heartbeat/heartbeat.service.ts`
- Create: `apps/worker/src/healthcheck.ts`
- Test: `apps/worker/src/heartbeat/heartbeat.service.spec.ts`

**Interfaces:**

- Consumes: `WORKER_ID` or container hostname, `APP_VERSION`, DB repository.
- Produces: immediate heartbeat and refresh every 15 seconds, idempotent by `worker_id`.
- Produces: CLI healthcheck exit `0` when own `RUNNING` heartbeat age <=45 seconds, otherwise non-zero.

- [x] **Step 1: Write failing timer/idempotency tests with a fake clock**

```ts
expect(repository.upsertHeartbeat).toHaveBeenCalledTimes(1); // immediately after start
await clock.advanceByAsync(15_000);
expect(repository.upsertHeartbeat).toHaveBeenCalledTimes(2);
```

- [x] **Step 2: Run and verify failure**

Run: `corepack pnpm vitest run apps/worker/src/heartbeat`

Expected: FAIL because service is absent.

- [x] **Step 3: Implement standalone Nest application context**

Worker does not call `listen()` and exposes no port. It handles SIGTERM, stops its timer, disconnects Prisma and never blocks API/Web if it is down; health accurately becomes unavailable.

- [x] **Step 4: Run Worker gates and commit**

```powershell
corepack pnpm --filter @yt-monitor/worker typecheck
corepack pnpm vitest run apps/worker
corepack pnpm --filter @yt-monitor/worker build
git add apps/worker
git commit -m "feat: add worker heartbeat lifecycle"
```

### Task 0.7: Next.js Web foundation và same-origin health access

**Files:**

- Create: `apps/web/package.json`, `tsconfig.json`, `next-env.d.ts`, `next.config.ts`, `postcss.config.mjs`
- Create: `apps/web/src/app/layout.tsx`, `page.tsx`, `globals.css`, `health/route.ts`
- Create: `apps/web/src/lib/create-health-response.ts`
- Test: `apps/web/src/lib/create-health-response.spec.ts`, `apps/web/src/app/page.spec.tsx`

**Interfaces:**

- Produces: Vietnamese foundation page and process-only `GET /health` using shared schema.
- Produces: same-origin rewrite `/api/v1/:path* -> http://api:5000/api/v1/:path*` inside Docker.
- Web health does not claim API/DB/Worker health; aggregate API endpoint owns dependency status.

- [x] **Step 1: Write failing Web contract tests**

```ts
expect(createWebHealth("0.1.0").service).toBe("web");
expect(createWebHealth("0.1.0").status).toBe("ok");
expect(renderedPage).toContain("Giám sát YouTube");
```

- [x] **Step 2: Run and verify failure**

Run: `corepack pnpm vitest run apps/web`

Expected: FAIL because Web files are absent.

- [x] **Step 3: Implement the minimal Vietnamese page, route and rewrite**

Page shows service name, Phase 0 status and a link to `/api/v1/health`; it does not invent metrics or mock dashboard data.

- [x] **Step 4: Run Web gates and commit**

```powershell
corepack pnpm --filter @yt-monitor/web typecheck
corepack pnpm vitest run apps/web
corepack pnpm --filter @yt-monitor/web build
git add apps/web
git commit -m "feat: add web foundation and health route"
```

### Task 0.8: Docker Compose clean boot và Phase 0 integration gate

**Files:**

- Create: `docker/Dockerfile`
- Create: `docker-compose.yml`
- Create: `scripts/health-check.ps1`, `scripts/test-phase0-docker.ps1`, `scripts/assert-health-response.ts`
- Create: `docs/ARCHITECTURE.md`, `docs/TESTING.md`
- Modify: `README.md`, `WORKLOG.md`

**Interfaces:**

- Produces services `postgres`, `db-migrate`, `worker`, `api`, `web`.
- Startup order: Postgres healthy → migration exits 0 → API/Worker độc lập → API
  DB-readiness → Web. Worker unavailable không được chặn API/Web; aggregate vẫn
  trả đúng 503 cho dependency bắt buộc này.
- Only Web binds host in Phase 0: `127.0.0.1:${WEB_PORT:-3000}:3000`.
- PostgreSQL volume mounts `/var/lib/postgresql` for the PostgreSQL 18 image layout; no DB/API/Worker host port.
- PostgreSQL remains only on the internal database network; Worker also joins a
  separate non-published bridge network for outbound collector/provider traffic.

- [x] **Step 1: Write integration script before Compose implementation**

The script creates a collision-resistant project name such as `ytmonitor-phase0-$PID`, chooses an unused loopback Web port, validates project name/volume labels before cleanup, and tests:

```text
fresh build and boot
migration applied and repeat deploy succeeds
two heartbeat upserts for one worker leave exactly one database row
web process health 200
API aggregate, DB and Worker health 200 through Web same-origin
collector/AI health 200 with disabled status
postgres/api/worker have no host bindings
exact Web/API/Worker/Postgres/db-migrate network membership and internal flags
stopped Worker becomes stale and aggregate returns 503 while DB stays 200
API/Web cold-start while Worker remains stopped still succeeds
restarted Worker recovers
stopped Postgres makes DB/aggregate unavailable without leaking error details
all 503 paths keep schema/stable code/no-store while Web process health stays 200
isolated Compose labels are verified; containers/networks/volume/images are absent after finally
```

- [x] **Step 2: Run the test and verify failure**

Run: `corepack pnpm test:integration`

Expected: FAIL because Dockerfile/Compose stack is absent.

- [x] **Step 3: Implement a root multi-stage Dockerfile**

Targets: `deps`, `build`, `web`, `api`, `worker`, `db-migrate`. Runtime targets use non-root users, exact Node base image and `corepack pnpm@11.22.0`; `db-migrate` runs `prisma migrate deploy` as a one-shot service.

Compose constraints:

```text
postgres health: pg_isready
runtime health interval: 10s
health timeout: 3s
health retries: 12
health start period: 20s
postgres restart: unless-stopped
api/worker/web restart: unless-stopped
no Caddy or cloudflared in Phase 0
```

- [x] **Step 4: Run the complete Phase 0 gate**

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build
corepack pnpm test:integration
docker compose up -d --build --wait
docker compose ps
```

Expected:

```text
typecheck: PASS
lint: PASS, zero warnings
unit tests: PASS
build: PASS
Postgres/Web/API/Worker: healthy
db-migrate: exited 0
Postgres/API/Worker: no public/host port
```

- [x] **Step 5: Update worklog/docs and commit the verified phase**

```powershell
git add docker docker-compose.yml scripts docs README.md WORKLOG.md
git commit -m "feat: complete phase zero healthy stack"
git status --short
```

Phase 0 is complete only after Step 4 evidence exists. A scaffold that has not passed Docker clean start is still Phase 0 in progress.

---

## 7. Phase 1 — Auth + Users

**Workstreams:** B002, B003, B012, B017; C001–C013; minimal J001/J018; secure-cookie baseline from L010.

**Files:**

- Prisma models/migration: `User`, `Session`, `AuditLog`; enum `UserRole { ADMIN VIEWER }`.
- `packages/auth/src/password.ts`, `session.ts`, `csrf.ts`, `authorization.ts`, `rate-limit.ts`.
- `apps/api/src/auth/*`, `apps/api/src/users/*`, auth guards and audit interceptor.
- `apps/web/src/app/login/*`, `apps/web/src/app/users/*`, authenticated shell.
- `prisma/seed.ts` reading admin email/password only from environment; no committed credentials.

**Interfaces:** exact REST endpoints from §70/§71; server-side opaque sessions in HttpOnly SameSite=Lax cookie; ADMIN-only user writes; `DELETE /users/:id` disables instead of hard deletes. Every `/api/v1/health*` route is ADMIN-only; Web has no anonymous HTTP health route and Docker uses internal TCP readiness.

- [x] Write Argon2id/session/CSRF/rate-limit tests first, including expiry, revocation and disabled user.
- [x] Add schema/migration/seed, then auth and user API endpoints.
- [x] Add minimal login/user-management UI in Vietnamese.
- [x] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, auth integration tests and browser E2E.
- [x] Verify anonymous protected routes 401; VIEWER read-only shell and every specified write 403; ADMIN writes succeed.

**Exit:** Admin + Viewer security works; no public signup; detailed health requires ADMIN; no anonymous HTTP liveness route exists; Docker process readiness uses internal TCP only. Channel/video collectors and monitoring metrics remain deferred.

## 8. Phase 2 — Channel resolution + RSS + yt-dlp

**Workstreams:** B004–B006/B010; D001–D013; minimal D014–D017; K001–K004/K007/K010; L004–L005; add-channel UI slice.

**Files:**

- Prisma: `Channel`, `ChannelSnapshot`, `ChannelDailyStat`, `SyncRun`, enums/statuses and specified unique/index constraints.
- `packages/collectors/youtube-rss/src/{fetch-feed,parse-feed,types}.ts`.
- `packages/collectors/ytdlp/src/{process-runner,normalize,resolve-channel,list-videos,errors}.ts`.
- `packages/collectors/youtube-public/src/resolve-channel.ts` minimal anonymous fallback.
- `apps/api/src/channels/*`, `apps/api/src/sync/*`.
- `apps/worker/src/jobs/{rss-discovery,channel-stats,daily-finalize}.job.ts`.
- `apps/web/src/app/channels/{page.tsx,new/page.tsx}`.

**Interfaces:** preserve the exact `PublicChannelProvider` interface in §6; normalized input accepts all §7 forms; create requires canonical `youtube_channel_id`; collector fields remain nullable and carry per-metric provenance.

- [x] Write URL normalization/canonical ID/dedup tests and yt-dlp fixture tests before code.
- [x] Implement metadata-only subprocess with timeout, low concurrency and normalized errors; command assertions reject media-download flags.
- [x] Implement RSS 15-minute configurable discovery and idempotent dedup.
- [x] Implement daily fresh snapshot at 00:10, signed delta, missing previous day `NULL`, coverage status and sync runs.
- [x] Add ADMIN REST/UI flow and repeat-create conflict handling.
- [x] Run global gates, collector fixture/integration tests and isolated Docker/browser E2E. Live public add-channel smoke remains conditional on upstream reachability and is documented separately.

**Exit:** Admin pastes `@handle` URL, system verifies public existence and persists one canonical Channel; no OAuth/API key/vidIQ backend.

## 9. Phase 3 — Playwright health + deletion safety

**Workstreams:** B009; D014–D023 completion; E001–E011; K005.

**Files:**

- `packages/collectors/youtube-public/src/{browser-context,render,metrics,detectors,evidence}.ts`.
- `packages/shared/src/channel-health/{signals,state-machine,activity,circuit-breaker}.ts`.
- `apps/worker/src/jobs/channel-health.job.ts`.
- `apps/api/src/channels/health/*`; Prisma `ChannelHealthCheck` migration.

**Interfaces:** anonymous fresh Chromium context, locale `en-US`; separate availability/activity enums; evidence contains only sanitized title/message/http state; pending metadata never equals deletion.

- [x] Write every §102 scenario and §96 mass-failure case before state machine implementation.
- [x] Implement block/CAPTCHA/network/timeout/layout failures as non-deletion outcomes.
- [x] Implement 30-minute retry, temporal confirmation, recovery reset and provider-incident circuit breaker.
- [x] Run global gates plus false-delete suite; assert no full HTML storage and no bypass behavior.

**Exit:** Availability works without false deletes; activity remains separate.

## 10. Phase 4 — Video discovery + snapshots

**Workstreams:** B007–B008; F001–F007/F018 candidate slice; K006/K008.

**Files:**

- Prisma `Video`, `VideoSnapshot`, monitor tier enum and unique `(video_id,snapshot_bucket)` migration.
- `apps/worker/src/video-monitor/{discovery,tiering,snapshot,reconcile}.ts`.
- `apps/api/src/videos/*` recent/snapshot endpoints.

**Interfaces:** RSS-first discovery + yt-dlp reconciliation; HOT <=7d or deterministic high local VPH, WARM 8–30d, old hot/pinned 6h, archive no hourly scan; nullable metric counters.

- [x] Write dedup, tier boundary, reactivation, pinned, retention and bucket-idempotency tests first.
- [x] Implement HOT hourly, WARM 3h, old hot/pinned 6h with locks/retry/stale-run recovery; jitter remains bounded by the hourly scheduler interval.
- [x] Run global gates and scheduler/integration tests against isolated DB fixtures.

**Exit:** Candidate videos are tracked and repeated execution cannot duplicate a snapshot bucket.

## 11. Phase 5 — Deterministic rankings

**Workstreams:** F008–F019; ranking indexes from B015.

**Files:**

- `packages/analytics/src/{deltas,vph,weekly-gain,breakout,percentiles,coverage}.ts`.
- `apps/api/src/videos/rankings/*`, dashboard ranking query repositories.
- Tests using exact §97–§99 fixtures.

**Interfaces:** pure functions accept timestamped nullable snapshots; signed outputs remain signed; `WeeklyGainResult = {status:"READY",gain:bigint,baselineAt:Date}|{status:"WARMING_UP"}`; rankings remain three separate endpoints.

- [x] Write weekly ranking, VPH, breakout, warm-up, NULL and negative-correction tests first.
- [x] Implement baseline window, same-channel sample, median/p75/p90 and server pagination.
- [x] Run global gates, ranking service/API tests and full Compose/Playwright integration acceptance.

**Exit:** Top 10 Week, Hot Now and Breakout work independently with deterministic evidence.

## 12. Phase 6 — Gemini structured AI

**Workstreams:** B013–B014; G001–G011; I001/I004–I010.

**Files:**

- `packages/crypto/src/aes-gcm.ts`, `mask-secret.ts`.
- `packages/ai/src/contracts/*`, `gemini/*`, `fingerprint.ts`, `cache.ts`, schemas.
- Prisma AI provider/model/run/result migrations.
- `apps/api/src/ai/*`, `apps/api/src/settings/ai/*`, daily/weekly worker jobs.

**Interfaces:** exact `AIProvider` contract from §33; Zod schemas from §39/§65; Gemini receives deterministic aggregate JSON only; cache key includes channel/range/sorted IDs/metric hash/prompt version.

- [x] Write AES-GCM, masking, schema rejection, fingerprint and no-AI tests first.
- [x] Implement provider health, strict structured calls, one configured repair retry, caching and run log.
- [x] Add existing-channel classification job without modifying Channel ID.
- [x] Run global gates and prove Gemini outage leaves collection/ranking/raw dashboard green.

### Phase 6 progress — 2026-08-23

- Added `@yt-monitor/crypto` with versioned AES-256-GCM envelopes, authenticated
  decryption, SHA-256 helper and UI-safe masking; the API never returns a full key.
- Added `@yt-monitor/ai` with the exact provider boundary, Gemini REST structured
  transport, strict Zod validation, one repair retry, safe error codes, provider
  health, fallback routing, stable fingerprints and TTL cache. Invalid output is
  rejected before persistence.
- Added Prisma enums/tables/migration for provider settings, model roles, AI run
  logs, channel/video analyses and daily/weekly report results. AI repositories are
  exposed through the existing serializable channel unit of work.
- Added authenticated API routes: `GET /api/v1/ai/status`, ADMIN-only
  `PATCH /api/v1/ai/settings`, and ADMIN-only existing-channel classification.
  `SECRET_ENCRYPTION_KEY` is required to save a key; settings responses expose
  only a masked suffix.
- Added a minimal ADMIN Vietnamese AI settings screen and worker report job. The
  job consumes a caller-provided deterministic aggregate and is explicitly skipped
  when AI is disabled or unavailable.
- Phase-specific evidence: 4 files / 17 tests plus Prisma validate/generate and
  full workspace typecheck PASS. Final global gates are green: lint, format check,
  78 files / 446 unit tests and workspace build. Clean Compose replay applied all
  6 migrations; auth integration passed 8 canonical files / 37 tests and the full Docker,
  API, Worker, Web and Playwright acceptance passed with AI unconfigured.

**Exit:** Structured Gemini reports work; invalid output never enters canonical analysis storage.

## 13. Phase 7 — NVIDIA + provider router

**Workstreams:** H001–H010; I002–I004 completion.

**Files:**

- `packages/ai/src/nvidia/{client,models,chat,errors,health}.ts`.
- `packages/ai/src/router/{roles,rules,router}.ts`.
- `apps/api/src/settings/ai/nvidia-models.controller.ts`.

**Interfaces:** configurable `/v1/models` and `/v1/chat/completions`; persisted roles `FAST/ANALYSIS/LONG_CONTEXT/FALLBACK`; no hard-coded DeepSeek/Kimi/Z-AI ID.

- [x] Write Gemini-429→NVIDIA and both-fail→AI-unavailable tests first.
- [x] Implement discovery, ADMIN selection, rate normalization and configurable routing.
- [x] Run global gates, §100 fallback test and disabled-provider test.

### Phase 7 progress — 2026-08-23

- Added `NvidiaProvider` for configurable OpenAI-compatible `/v1/models` and
  `/v1/chat/completions`, bearer-key handling, structured JSON validation, one
  repair retry, safe 429/401/network errors and health checks. No vendor model
  ID is hard-coded.
- Extended `AIProviderRouter` with logical `FAST/ANALYSIS/LONG_CONTEXT/FALLBACK`
  roles, provider-aware model routing, primary failure fallback, aggregate health,
  model discovery and last-used provider/model metadata.
- Wired production API startup to Gemini primary + NVIDIA fallback using the
  existing environment configuration. Persisted ADMIN-selected model IDs now
  update `ai_model_roles`; ADMIN endpoints expose provider test and model discovery.
- Expanded the Vietnamese AI settings UI with Gemini/NVIDIA tabs, masked-key
  settings, provider test and “Refresh available models”.
- Phase-specific tests pass: 2 files / 13 tests covering NVIDIA discovery,
  structured output/errors, Gemini-429→NVIDIA fallback, both-provider failure and
  no-AI behavior.
- Exit gates pass: workspace typecheck, lint, format check, production build and
  79 files / 453 unit tests. Clean six-migration Compose/API/Worker/Web/Playwright
  acceptance also passed with AI unconfigured; provider-specific protocol and
  fallback behavior is covered by the targeted suite.

**Exit:** Fallback/deep analysis works while all-AI failure leaves core monitoring healthy.

### Phase 7 remediation — 2026-08-25

- Replaced the environment-only runtime wiring with database-first provider
  runtime construction. Encrypted ADMIN keys, enabled state, base URL and model
  roles now take effect immediately; environment values remain bootstrap fallback.
- Added one backend catalog with friendly labels/recommended defaults and merged
  live Gemini/NVIDIA discovery. IDs remain configuration and custom ADMIN values
  are still supported; no model-specific branch was added to router logic.
- Replaced the exact-ID-first UI with a dropdown that hydrates the saved model or
  selects the recommended model. Manual ID entry is now an advanced option.
- Added Gemini discovery and header-based API-key authentication, LOCAL encryption
  key provisioning, Compose AI environment wiring and ADMIN page gating.
- Remediation gates pass: workspace typecheck/lint/format/build, 86 files / 474
  unit tests and local browser QA with non-secret mock provider responses.

## 14. Phase 8 — Dashboard completion

**Workstreams:** J001–J023 completion plus all §106 pagination surfaces.

**Files:**

- `packages/ui/*`; `apps/web/src/app/(dashboard)/*` for Dashboard, Channels, Videos, AI, Sync, Users, Settings.
- Typed API client/query keys, tables, charts, forms, loading/error/empty, freshness and coverage badges.

**Interfaces:** raw metrics and AI cards visually separate; AI cards link exact deterministic evidence; unsupported aggregate is hidden rather than substituted; Viewer has no effective write action.

- [x] Write component/accessibility tests and browser flows before each screen slice.
- [x] Complete the repository-owned Vietnamese dashboard surfaces in J001–J023.
- [x] Run global gates, browser route build/E2E and server-pagination tests.

### Phase 8 progress — 2026-08-23

- Replaced the placeholder home page with real channel/video/ranking summaries,
  freshness labels, empty states, ADMIN health cards and AI report availability.
- Added channel detail and analyze-channel action, sync-run history, collector
  settings boundary, and navigation routes for `/sync` and
  `/settings/collectors`.
- Added server-side sync-run pagination and client pagination for channels, videos
  and health history. Existing users/rankings pagination remains server-backed.
- Added typed browser contracts and tests for the new dashboard empty/data states.

Acceptance evidence: workspace typecheck, lint, format check and production
build passed; unit suite passed (80 files / 456 tests); six-migration Compose,
API/Worker/Web and Playwright acceptance passed (8 canonical files / 37 database and
auth integration tests plus browser flow).

### Phase 8 metrics remediation — 2026-08-25

- Wired the previously dormant channel-stats/daily jobs into the Worker lifecycle
  and implemented a bounded public YouTube About collector for subscriber count,
  video count and lifetime views. Newly added channels are scanned immediately or
  within 30 seconds, with a 15-minute safe retry after partial collection.
- Added the authenticated typed `GET /api/v1/dashboard/trends?days=28` surface.
  View/subscriber deltas are computed only from canonical snapshots; missing or
  stale endpoints remain `NULL`. The response exposes requested/complete/partial
  days and coverage percent, and discovered videos are grouped by local publish date.
- Added a YouTube-Studio-inspired three-metric trend panel for public view delta,
  subscriber delta and newly discovered videos. Revenue is omitted. Watch time is
  explicitly unavailable under the public-only contract and is never estimated or
  replaced with a different metric.
- Added honest baseline warm-up, no-channel, loading and failure states; selectable
  responsive SVG series with null gaps; screen-reader daily data; bounded 10-second
  warm-up polling followed by a one-minute refresh; and a two-column mobile nav that
  cannot widen the page.
- Made daily catch-up restart-idempotent. Before any YouTube request, the Worker
  checks which channels lack today's canonical row; existing `COMPLETE` or `PARTIAL`
  rows are preserved and no extra scan is issued.

Acceptance evidence: workspace Prisma validate/generate, typecheck, lint, format,
production build and 96 files / 515 unit tests passed. Clean six-migration
Compose/API/Worker/Web acceptance passed with 8 integration files / 37 tests.
Live isolated Docker/browser QA collected 14,400 subscribers, 638 videos and
2,408,026 lifetime views for `@miumiutruyenaudio`; desktop and 390×844 mobile
rendering passed with mobile `scrollWidth === clientWidth`.

### Phase 8 public-intelligence and grounded-AI completion — 2026-08-26

- Added the authenticated `GET /api/v1/channels/:id/public-intelligence?days=30`
  contract. Every metric declares status, class, precision, source, observation
  time and reason; missing baselines stay warming/unavailable instead of becoming
  zero or inferred history.
- Kept actual videos observed as published during the selected window separate
  from the signed public inventory delta. Removed/private content and public-data
  corrections therefore cannot be mislabeled as publishing behavior.
- Added deterministic average-duration/upload-frequency aggregates from locally
  observed public metadata. Video-catalog coverage remains explicit and partial
  until a complete reconciliation watermark exists.
- Grounded daily/weekly AI reports in stable evidence IDs. Every prose claim must
  cite evidence, every numeric token must occur verbatim in its cited evidence,
  public text is treated as untrusted input, and insufficient coverage skips the
  provider call entirely. AI results remain confined to AI tables.
- Wired scheduled daily/weekly Worker runs with database-first encrypted provider
  settings and Gemini→NVIDIA fallback. The dashboard reads the latest available
  weekly report on or before the requested date instead of hiding Monday reports
  later in the week.
- Scheduled report occurrences now carry a fixed timezone-resolved cutoff end to end,
  catch up the most recent missed weekly occurrence and use occurrence-keyed
  fingerprints so restart/retry cannot overwrite a successful report after
  post-cutoff metadata drift. Nonexistent DST wall times resolve to the first valid
  later local minute rather than running early.
- Added the channel intelligence panel, detailed channel table, visible grounded
  AI report/evidence content, classification result card and a data-source legend.
  The UI never presents AI text as a metric source and does not depend on vidIQ,
  browser cookies, Google login or a private Analytics scope.
- PARTIAL reports are rejected unless a limitation cites canonical coverage evidence,
  and the UI renders a deterministic PARTIAL banner. Current channel totals come from
  typed public-intelligence metrics with complete provenance; stale header counters
  are never substituted when intelligence is unavailable.

Targeted acceptance covered public-intelligence, grounding, scheduler, API and Web
contracts. Final review regressions additionally cover the real 08:00 Asia/Bangkok
occurrence boundary, restart-stable fingerprints, weekly catch-up, DST gaps,
baseline-aware precision, same-target numeric grounding, PARTIAL coverage,
evidence/provider/model provenance and a 12-hour stale-current threshold. Workspace
`pnpm verify` passed with 109 files / 584 unit tests plus every
production build. Clean Compose acceptance passed all six
migrations, 8 integration files / 37 tests, API/Worker/Web recovery and containerized
Playwright; isolated resources were removed afterward.

**Exit:** All specified dashboard routes/user workflows work against real authenticated APIs.

## 15. Phase 9 — LAN, Caddy, Cloudflare Tunnel và security

**Workstreams:** L001–L012 completion.

**Files:** production Docker targets, `Caddyfile`, cloudflared config/template, deployment/security docs and LAN/public smoke scripts.

**Interfaces:** `https://domain/` → Web; `/api/v1/*` → API; only Caddy/LAN proxy exposed; tunnel outage does not break LAN.

- [ ] Require domain/tunnel credentials from owner before external-state setup.
- [x] Write repository security assertions for port exposure, Caddy routing,
      trusted-proxy boundary and cookie flags (API/auth suites retain the fail-closed
      `TRUST_PROXY` boundary and exact LOCAL/PUBLIC cookie contracts).
- [x] Run global gates and local hosting-profile smoke with the tunnel stopped.
- [ ] Run mobile-network public HTTPS smoke after the owner supplies domain and
      tunnel credentials.

### Phase 9 progress — 2026-08-23

- Added loopback-safe Web binding, optional Caddy profile, `/api/*` → internal
  API routing, security headers, persistent Caddy data/config volumes and
  restart-policy assertions.
- Added hosting documentation for deliberate LAN binding and same-origin public
  deployment. No Cloudflare token, DNS record or public endpoint was created.
- External acceptance remains intentionally open: owner-provided domain/tunnel
  credentials and a mobile-network HTTPS smoke are required.

**Exit:** §104 and hosting acceptance pass; Postgres/Worker/internal API remain unreachable externally.

## 16. Phase 10 — Hardening, backup/restore và final acceptance

**Workstreams:** L013–L016; final B015/B016/index audit; retention, performance, recovery and all acceptance criteria.

**Files:** `scripts/backup-db.ps1`, `restore-db.ps1`, retention/rollup jobs, complete docs and acceptance trace matrix.

- [x] Write isolated backup/restore contract tests with checksum and empty-artifact
      rejection before the scripts.
- [x] Validate retention never deletes weekly-ranking-required data before a
      durable weekly rollup exists; no destructive retention job is enabled yet.
- [x] Audit structured logs/redaction, pagination/indexes and restart policy;
      host reboot acceptance remains an operator action on the target Docker host.
- [ ] Run the complete §131 command set, including public HTTPS and host-reboot
      checks that require external state.

### Phase 10 progress — 2026-08-23

- Added checksum-reporting `backup-db.ps1`, guarded `restore-db.ps1`, backup
  contract tests, retention-safety documentation and restart-policy checks.
- Backups are written only under ignored `backups/`; restore requires an explicit
  `-Force` and preserves the original artifact. No automatic deletion is present
  until a durable weekly rollup policy is approved.
- Repository gates pass; a real restore/row-count run and reboot/public smoke
  must be performed by the owner against the intended host and data volume.
- Final audit remediation moved Argon2 outside the bootstrap advisory-lock window,
  re-checks identity under the same lock before insert, and limits integration
  discovery to 8 canonical source files. The concurrency regression and full
  Docker/API/Worker/Web/Playwright acceptance pass without changing bootstrap
  `CREATED`/`UNCHANGED` semantics.
- The transitive `deepmerge-ts` advisory is remediated with a workspace-wide
  override to patched `8.0.2`; Prisma uses only the preserved `deepmerge` entrypoint.
  Frozen install, Prisma validate/generate, audit and all repository gates must
  remain green with this override.

Final gate:

```text
typecheck
lint
unit tests
integration tests
E2E channel add
E2E weekly ranking
health false-delete tests
AI fallback tests
Docker clean start
backup/restore test
LAN smoke test
public HTTPS smoke test
```

Target load: <=100 channels, <=100.000 known videos, <=5.000 active candidates; p95 LAN <1,5s và public <2,5s typical connection.

## 17. Phase 11 — Channel groups, scoped viewers và honest partial metrics

**Scope addendum approved in conversation on 2026-08-26:** channel groups were
optional after the original MVP. This phase adds them without weakening the
canonical metric invariants.

**Execution result (2026-08-26):** the group schema/API/UI, multi-group access
scope, explicit subscriber-zero parsing and observed partial timeline shipped on
`phase/0-foundation`. `pnpm verify` passed 117 test files / 654 tests and all
production builds. A fresh isolated `pnpm test:integration` applied all eight
migrations, passed 11 PostgreSQL integration files / 45 tests, exercised
API/Worker/Web outage recovery and the updated group-scoped Playwright flow, then
verified cleanup.

### 17.1 Group model and administration

- [x] Add `ChannelGroup`, `ChannelGroupChannel` and `UserChannelGroup` with
      many-to-many membership, unique constraints and indexes.
- [x] Backfill one compatibility group for existing non-archived channels and
      existing VIEWER accounts during upgrade; fresh channels remain explicitly
      assigned by ADMIN.
- [x] Add authenticated group read APIs and ADMIN-only create/update/archive,
      atomic channel membership replacement and atomic VIEWER assignment.
- [x] Add an ADMIN screen to create groups, assign channels, and assign one or
      many groups to each VIEWER.

### 17.2 Server-authoritative access scope

- [x] ADMIN remains unrestricted. VIEWER scope is the union of channels in all
      assigned, non-archived groups; a VIEWER with no groups sees zero channels.
- [x] Apply scope at the API/service/repository boundary to channel lists and
      details, public intelligence, health history, videos, snapshots, rankings
      and dashboard trends. Unauthorized direct resource access returns not found.
- [x] Keep sync-run inspection and global AI reports ADMIN-only until those
      artifacts have a group-scoped generation fingerprint; UI hiding alone is
      not an authorization boundary.

### 17.3 Honest partial timeline and subscriber display

- [x] Keep strict totals/deltas `NULL` unless every visible channel is comparable,
      and add observed aggregates with explicit covered/total channel counts.
- [x] Render partial timeline values and coverage instead of blanking the whole
      portfolio because one channel lacks a public counter. Never fabricate a
      missing day, baseline, subscriber count or historical value.
- [x] Parse canonical YouTube `No subscribers` as explicit public zero, enrich
      missing HTML fields from the canonical rendered About surface, and preserve
      ambiguous/missing counters as `NULL`.
- [x] Dashboard uses an explicitly labelled lower bound for known subscriber
      values. Per-channel missing subscriber UI may show `0*` only with the visible
      qualifier `chưa xác minh`; it must not serialize or aggregate that display
      fallback as canonical zero.

### 17.4 Gates

- [x] Prisma validate/generate and clean migration replay/upgrade.
- [x] Unit tests for zero-group deny-all, multi-group union/dedup, archived group,
      explicit zero versus missing, partial observed timeline and negative deltas.
- [x] API/E2E tests prove an assigned resource is readable, an unassigned resource
      is absent/404, and membership changes affect an existing session immediately.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`, integration, Docker and browser
      acceptance pass before commit/push.

### 17.5 Dashboard group/channel scope selectors

- [x] Add one accessible group selector above the KPI cards. Its default scope is
      every group visible to the current actor; VIEWER options come only from the
      authenticated `/channel-groups/accessible` contract.
- [x] Add one channel selector beside it. Its default is every channel in the
      selected group (or every visible channel when no group is selected), and it
      resets safely whenever the group changes.
- [x] Apply the same server-authoritative `groupId` / `channelId` scope to channel
      KPIs, the 28-day trend, recent videos and the rolling seven-day ranking.
      Explicit missing, archived, unauthorized or group/channel-mismatched values
      return not found; an empty group remains empty and never falls back globally.
- [x] Abort or ignore stale requests after a scope change, preserve the selected
      scope during refresh/warm-up polling, and distinguish global ADMIN health/AI
      surfaces from scoped canonical metrics.
- [x] Add API/controller/service and UI regressions for ADMIN, VIEWER, empty group,
      reset/default behavior and rapid selection changes; rerun the full Phase 11
      typecheck, lint, unit, integration, Docker and browser gates before push.

**Exit:** ADMIN can manage groups and multi-group viewer assignments; every read
surface honors the same effective scope; partial metrics are useful but never
misrepresented as complete or as zero.

## 18. Invariant traceability gates

| Invariant                                     | Enforcement artifact                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| AI != DATA SOURCE                             | Package dependency rule; raw repositories have no AI input types; Phase 6 outage tests |
| VIDIQ BASIC != BACKEND API                    | Dependency/license scan; no vidIQ package, cookie, endpoint or scraper                 |
| CHANNEL URL → CANONICAL CHANNEL ID            | Phase 2 normalization/resolution E2E and DB unique constraint                          |
| TEMPORARY FAILURE != DELETED CHANNEL          | Phase 3 state-machine/mass-failure test suite                                          |
| TOP 10 WEEK = ROLLING 7-DAY VIEW GAIN         | Phase 5 exact §97 fixture and endpoint contract                                        |
| HOT NOW = LOCAL VIEW VELOCITY                 | Phase 5 local snapshot-only input test                                                 |
| BREAKOUT = SAME-CHANNEL BASELINE              | Phase 5 cross-channel exclusion test                                                   |
| SERVER SNAPSHOTS = HISTORICAL SOURCE OF TRUTH | No-backfill test, provenance fields and AI write-boundary test                         |

Trước khi sửa bất kỳ hàng nào trong bảng này, implementer phải dừng, nêu lý do/ảnh hưởng và nhận chấp thuận trực tiếp của chủ dự án.

## 19. Definition of done cho mỗi phase

Một phase chỉ được đánh dấu hoàn tất khi:

1. Tất cả task/exit gate của phase có evidence chạy thực tế.
2. `pnpm typecheck`, `pnpm lint`, `pnpm test` đều exit code 0.
3. Phase-specific unit/integration/E2E tests exit code 0.
4. Migration deploy được thử trên database sạch và lặp lại an toàn.
5. Không có secret trong source/log/test artifact.
6. Critical invariant traceability vẫn xanh.
7. `WORKLOG.md` ghi command, kết quả, assumption đã xác minh và blocker còn lại.
8. Chỉ sau đó mới commit phase và đề xuất chuyển sang phase kế tiếp.
