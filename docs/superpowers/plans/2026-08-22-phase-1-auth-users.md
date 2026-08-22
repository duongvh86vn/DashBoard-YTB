# Phase 1 Auth + Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure ADMIN/VIEWER authentication, server-side sessions, user administration, and a minimal Vietnamese authenticated UI without public signup.

**Architecture:** Passwords use Argon2id, browsers receive only an opaque host-only session cookie, and PostgreSQL stores a keyed token hash plus revocation/expiry state. A default-deny NestJS pipeline enforces session, role, CSRF, and audit policies; Next.js remains same-origin and exposes a small Vietnamese login/users slice. PostgreSQL remains the authority for users, sessions, throttles, and audit history.

**Tech Stack:** Node.js 24, pnpm 11.22.0, TypeScript strict, Prisma 7/PostgreSQL 18, NestJS 11, Next.js 16/React 19, Argon2id, Zod, Vitest, Supertest, Playwright.

**Spec:** `C:\Users\Duongvh-pc\Downloads\YOUTUBE_HOME_MONITOR_AI_SPEC.md`, especially §§47–48, 69–71, 79, 85–87, 91–92, 103, 106, 109–110, 117, 119–120, 125–128. Parent plan: `IMPLEMENTATION_PLAN.md` §7.

## Global Constraints

- Server is the source of truth; raw metrics and canonical rankings remain deterministic.
- ADMIN creates users; VIEWER is read-only; there is no public signup.
- Use Argon2id, server-side opaque sessions, HttpOnly cookies, CSRF protection, and login rate limiting.
- Public deployment cookies are `Secure=true` and `SameSite=Lax`; local loopback HTTP uses a separate host-only non-Secure cookie name.
- PostgreSQL, Worker, Docker daemon, Playwright debug ports, and the internal API remain unpublished.
- UI text is Vietnamese.
- Secrets, raw passwords, raw session tokens, cookie values, and password hashes never enter source, logs, audit metadata, or API responses.
- `DELETE /users/:id` disables the VIEWER; no public API hard-deletes users.
- TypeScript keeps `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `useUnknownInCatchVariables` enabled.
- Every production behavior follows RED → GREEN → REFACTOR; each new test names the break it catches and exercises real behavior.
- After Phase 1 run `pnpm typecheck`, `pnpm lint`, `pnpm test`, the auth/database integration suite, browser E2E, a clean migration replay, and Docker clean boot.
- Do not change any critical invariant from `IMPLEMENTATION_PLAN.md` §17 or the authoritative spec §128.

## Resolved Phase 1 contracts

- `GET /api/v1/health/live` is the only anonymous API liveness route and returns exactly `{"status":"ok"}` with `Cache-Control: no-store`. Existing detailed health routes require ADMIN.
- The §103 anonymous analytics assertion is represented in Phase 1 by a default-deny protected-route test; the exact analytics URL assertion belongs to the phase that creates analytics routes. No fake analytics endpoint is added.
- User APIs manage VIEWER accounts only. ADMIN bootstrap is environment-only; APIs cannot create, promote, disable, reset, revoke, or delete an ADMIN.
- `POST /users` accepts `{email,password}` and creates VIEWER. `PATCH /users/:id` accepts only `{email}`. Password reset accepts `{password}`. `DELETE` has the same disable semantics as `POST /disable`.
- User list shape is `{items,page,pageSize,total}` with `page >= 1`, `1 <= pageSize <= 100`, ordered by `createdAt DESC, id DESC`.
- Email is trimmed and lowercased before persistence; password text is never normalized. Password policy is 12–128 Unicode code points.
- Argon2id parameters are version 1.3, 64 MiB memory, time cost 3, parallelism 1, 32-byte hash, and a library-generated salt of at least 16 bytes.
- Session tokens contain 32 CSPRNG bytes encoded base64url. PostgreSQL stores only `HMAC-SHA-256(SESSION_SECRET, token)`. Defaults are 120-minute idle and 24-hour absolute expiry.
- Local cookie: `yhm_session`, `Secure=false`. Public cookie: `__Host-yhm_session`, `Secure=true`. Both are host-only, `HttpOnly`, `SameSite=Lax`, `Path=/`, with no `Domain`.
- Unsafe requests require JSON content type, an exact allowed `Origin`, and `X-CSRF-Protection: 1`. CORS remains disabled and GET routes stay side-effect-free.
- Login throttling is PostgreSQL-backed and atomic for normalized-identifier and source buckets. At 5 failures within 15 minutes the bucket is blocked for 15 minutes. Unknown, disabled, locked, and wrong-password users share `AUTH_INVALID_CREDENTIALS`.
- Successful password change, admin password reset, and disable revoke all target sessions. Self password change clears the current cookie and requires a new login.
- API errors use `{error:{code,message}}`. Status/code pairs: 400/`VALIDATION_ERROR`, 401/`AUTH_UNAUTHENTICATED`, 401/`AUTH_INVALID_CREDENTIALS`, 403/`AUTH_FORBIDDEN`, 403/`AUTH_CSRF_INVALID`, 404/`USER_NOT_FOUND`, 409/`USER_ALREADY_EXISTS`, 429/`AUTH_RATE_LIMITED`.
- Audit actions are semantic service events, committed in the same transaction as successful security mutations. Audit metadata is an allowlisted object and never stores credentials.

---

### Task 1: Pin auth dependencies, configuration, and shared contracts

**Files:**

- Create: `packages/auth/package.json`, `packages/auth/tsconfig.json`, `packages/auth/tsconfig.build.json`
- Create: `packages/auth/src/contracts.ts`, `packages/auth/src/index.ts`
- Test: `packages/auth/src/contracts.spec.ts`
- Modify: `packages/config/src/api-env.ts`, `packages/config/src/env.spec.ts`, `packages/config/src/index.ts`
- Modify: `.env.example`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- Modify: `apps/api/package.json`, `docker/Dockerfile`, `vitest.config.ts`, `vitest.integration.config.ts`

**Interfaces:**

- Produces `AuthEnvironment` with `DEPLOYMENT_MODE`, `APP_PUBLIC_URL`, `APP_ALLOWED_ORIGINS`, `SESSION_SECRET`, `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`, `LOGIN_MAX_ATTEMPTS`, and `LOGIN_LOCK_MINUTES`.
- Produces `UserRoleValue = "ADMIN" | "VIEWER"`, `PublicUser`, `AuthErrorCode`, `SESSION_COOKIE_LOCAL`, `SESSION_COOKIE_PUBLIC`, and `CSRF_HEADER_NAME`.
- Pins `argon2@0.45.1`, `cookie@2.0.1`, `zod@4.4.3`, and `@types/express@5.0.6`; permits only the required `argon2` install build in pnpm policy.

- [ ] **Step 1: Write failing config and contract tests**

```ts
expect(() => parseApiEnv(validApiEnv({ SESSION_SECRET: "short" }))).toThrow();
expect(parseApiEnv(validApiEnv()).APP_ALLOWED_ORIGINS).toEqual(["http://127.0.0.1:3000"]);
expect(() =>
  parseApiEnv(
    validApiEnv({
      DEPLOYMENT_MODE: "PUBLIC",
      APP_PUBLIC_URL: "http://example.test",
    }),
  ),
).toThrow();
expect(SESSION_COOKIE_PUBLIC).toBe("__Host-yhm_session");
```

- [ ] **Step 2: Run RED**

Run: `corepack pnpm vitest run packages/config/src/env.spec.ts packages/auth/src/contracts.spec.ts`

Expected: FAIL because the auth package/contracts and Phase 1 API environment parser do not exist.

- [ ] **Step 3: Implement the minimal contracts and validated environment**

```ts
export interface PublicUser {
  id: string;
  email: string;
  role: "ADMIN" | "VIEWER";
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export const SESSION_COOKIE_LOCAL = "yhm_session";
export const SESSION_COOKIE_PUBLIC = "__Host-yhm_session";
export const CSRF_HEADER_NAME = "x-csrf-protection";
```

`APP_ALLOWED_ORIGINS` is a comma-separated list of absolute HTTP(S) origins, trimmed, deduplicated, and required to contain `APP_PUBLIC_URL`. `PUBLIC` requires an HTTPS public URL and a 32-character-or-longer secret; `LOCAL` permits loopback HTTP. No secret is defaulted.

- [ ] **Step 4: Install exact dependencies and run GREEN**

Run:

```powershell
corepack pnpm install
corepack pnpm vitest run packages/config/src/env.spec.ts packages/auth/src/contracts.spec.ts
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
```

Expected: targeted tests and global gates PASS with pristine output.

- [ ] **Step 5: Commit**

```powershell
git add packages/auth packages/config .env.example package.json pnpm-workspace.yaml pnpm-lock.yaml apps/api/package.json docker/Dockerfile vitest.config.ts vitest.integration.config.ts
git commit -m "chore: define phase one auth contracts"
```

### Task 2: Implement password, session, CSRF, authorization, and throttle primitives

**Files:**

- Create: `packages/auth/src/password.ts`, `session.ts`, `csrf.ts`, `authorization.ts`, `rate-limit.ts`, `cookie.ts`
- Test: matching `*.spec.ts` files under `packages/auth/src/`
- Modify: `packages/auth/src/index.ts`

**Interfaces:**

- Produces `normalizeEmail(email): string`, `assertPasswordPolicy(password): void`, `hashPassword(password): Promise<string>`, and `verifyPassword(hash,password): Promise<{valid:boolean;needsRehash:boolean}>`.
- Produces `createSessionCredential(secret, randomBytes?): {token:string;tokenHash:Uint8Array}` and `hashSessionToken(secret,token): Uint8Array`.
- Produces `calculateSessionExpiry(now,idleMinutes,absoluteHours)` and `isSessionUsable(session,now)` with exclusive expiry boundaries.
- Produces `validateCsrfRequest(input): boolean`, `canManageUsers(role): boolean`, `nextThrottleState(current,now,policy)`, and `createSessionCookiePolicy(mode,absoluteHours)`.

- [ ] **Step 1: Write RED tests for every observable security boundary**

```ts
expect(normalizeEmail("  Admin@Example.COM ")).toBe("admin@example.com");
await expect(hashPassword("short")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
expect(createSessionCredential(secret, fixed32Bytes).token).toHaveLength(43);
expect(isSessionUsable(sessionAtIdleBoundary, now)).toBe(false);
expect(validateCsrfRequest(validUnsafeRequest)).toBe(true);
expect(validateCsrfRequest({ ...validUnsafeRequest, origin: "https://evil.test" })).toBe(false);
expect(nextThrottleState(fourFailures, now, policy).blockedUntil).toEqual(
  new Date("2026-08-22T00:15:00.000Z"),
);
```

Tests inspect the Argon2 PHC parameters, prove a realistic wrong password fails, prove changing the raw token changes its HMAC, prove raw tokens cannot be recovered from stored hashes, and cover ADMIN/VIEWER authorization.

- [ ] **Step 2: Run RED**

Run: `corepack pnpm vitest run packages/auth/src`

Expected: FAIL because the primitive modules are absent.

- [ ] **Step 3: Implement only the tested primitives**

Use Node `randomBytes`/`createHmac`/`timingSafeEqual`, `argon2.argon2id` with the fixed parameters above, exact Origin comparison, and immutable date calculations. Cookie policy returns no `domain` field.

- [ ] **Step 4: Run GREEN and package gates**

Run:

```powershell
corepack pnpm vitest run packages/auth/src
corepack pnpm --filter @yt-monitor/auth typecheck
corepack pnpm --filter @yt-monitor/auth build
corepack pnpm lint
corepack pnpm test
```

Expected: all auth and global unit tests PASS without warnings.

- [ ] **Step 5: Commit**

```powershell
git add packages/auth
git commit -m "feat: add authentication primitives"
```

### Task 3: Add identity, session, throttle, audit schema and bootstrap admin

**Files:**

- Modify: `prisma/schema.prisma`, `prisma.config.ts`, `packages/db/src/index.ts`
- Create: `prisma/migrations/20260822000000_phase1_auth_users/migration.sql`
- Create: `packages/db/src/user.repository.ts`, `session.repository.ts`, `login-throttle.repository.ts`, `audit-log.repository.ts`
- Test: matching unit and `*.integration.spec.ts` repository tests
- Create: `packages/db/src/seed-admin.ts`, `packages/db/src/seed-admin.spec.ts`, `prisma/seed.ts`
- Modify: `packages/db/package.json`, `package.json`

**Interfaces:**

- Adds `UserRole { ADMIN VIEWER }`, `AuditOutcome { SUCCESS FAILURE }`, and models `User`, `Session`, `LoginThrottle`, `AuditLog`.
- `Session.tokenHash` and `LoginThrottle.keyHash` are PostgreSQL `bytea` values with unique/index constraints.
- Produces repositories for canonical-email lookup/create/list/update, active-session lookup/touch/revoke, atomic throttle failure/clear, and append-only audit.
- Produces `seedInitialAdmin({email,password}, dependencies)`. It creates one active ADMIN only in an empty identity store, is idempotent for the same active ADMIN, and aborts on conflicting or populated-without-admin state.

- [ ] **Step 1: Write RED repository and seed tests**

```ts
await repository.createViewer({ email: "viewer@example.com", passwordHash });
await expect(
  repository.createViewer({ email: "viewer@example.com", passwordHash }),
).rejects.toMatchObject({ code: "USER_ALREADY_EXISTS" });
expect(await sessions.findUsableByHash(tokenHash, expiryBoundary)).toBeNull();
expect(await seedInitialAdmin(input, fakes)).toEqual({ status: "CREATED" });
expect(await seedInitialAdmin(input, fakes)).toEqual({ status: "UNCHANGED" });
```

Integration tests prove atomic fifth-failure blocking under concurrent calls, revoked/disabled sessions are unusable, pagination ordering is stable, audit rows contain no planted credential markers, and ADMIN bootstrap cannot silently promote/reset/re-enable.

- [ ] **Step 2: Run RED**

Run: `corepack pnpm db:generate && corepack pnpm vitest run packages/db/src/seed-admin.spec.ts packages/db/src/user.repository.spec.ts`

Expected: FAIL because schema models and repositories do not exist.

- [ ] **Step 3: Add migration, repositories, and explicit seed entrypoint**

The seed CLI reads only `DATABASE_URL`, `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD`, validates them, never prints their values, hashes through `@yt-monitor/auth`, and always disconnects.

- [ ] **Step 4: Validate/generate and run GREEN**

Run:

```powershell
corepack pnpm db:validate
corepack pnpm db:generate
corepack pnpm vitest run packages/db
corepack pnpm --filter @yt-monitor/db typecheck
corepack pnpm lint
corepack pnpm test
```

Expected: schema, repository/seed tests, and global unit gates PASS.

- [ ] **Step 5: Commit**

```powershell
git add prisma packages/db package.json
git commit -m "feat: persist users sessions and audit history"
```

### Task 4: Establish the default-deny API security pipeline and protected health

**Files:**

- Create: `apps/api/src/auth/public.decorator.ts`, `roles.decorator.ts`, `request-user.ts`
- Create: `apps/api/src/auth/session.guard.ts`, `roles.guard.ts`, `csrf.guard.ts`, `auth-exception.filter.ts`
- Create: `apps/api/src/auth/security-pipeline.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/main.ts`
- Modify: `apps/api/src/health/health.controller.ts` and health HTTP tests
- Modify: `docker-compose.yml` API healthcheck path

**Interfaces:**

- Produces `@Public()` and `@Roles("ADMIN")` metadata, `AuthenticatedRequest.user: PublicUser`, and default-deny global guards.
- Produces public `GET /api/v1/health/live` with exact minimal response; detailed health routes require authenticated ADMIN.
- App module accepts injected environment/database/auth collaborators for tests while production parses process environment once.

- [ ] **Step 1: Write RED HTTP policy tests**

```ts
await request(app.getHttpServer()).get("/api/v1/health/live").expect(200, { status: "ok" });
await request(app.getHttpServer()).get("/api/v1/health/db").expect(401);
await authenticatedViewer.get("/api/v1/health/db").expect(403);
await authenticatedAdmin.get("/api/v1/health/db").expect(200);
await request(app.getHttpServer()).get("/test-protected").expect(401);
```

The protected probe exists only inside the test module. Tests also cover invalid/expired/revoked/disabled sessions and ensure error responses do not expose cookie/token/database details.

- [ ] **Step 2: Run RED**

Run: `corepack pnpm vitest run apps/api/src/auth/security-pipeline.e2e-spec.ts apps/api/src/health/health.e2e.spec.ts`

Expected: FAIL because guards and minimal liveness route are absent.

- [ ] **Step 3: Implement global guards/filter and refactor module composition**

Order is session → role → CSRF for unsafe routes. `@Public()` bypasses session/role but not the login CSRF policy supplied by its controller. API continues to bind only `0.0.0.0:5000` inside Docker; CORS is not enabled.

- [ ] **Step 4: Run GREEN and API gates**

Run:

```powershell
corepack pnpm vitest run apps/api/src/auth apps/api/src/health
corepack pnpm --filter @yt-monitor/api typecheck
corepack pnpm --filter @yt-monitor/api build
corepack pnpm lint
corepack pnpm test
```

Expected: HTTP policy, existing health behavior for ADMIN, and global gates PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api docker-compose.yml
git commit -m "feat: enforce default deny API security"
```

### Task 5: Implement login, logout, current-user, and password-change endpoints

**Files:**

- Create: `apps/api/src/auth/auth.controller.ts`, `auth.service.ts`, `auth.schemas.ts`
- Create: `apps/api/src/auth/session-authenticator.ts`, `session-cookie.service.ts`, `login-throttle.service.ts`
- Test: matching unit tests and `apps/api/src/auth/auth.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**

- `POST /api/v1/auth/login` accepts `{email,password}`, returns `{user:PublicUser}`, and sets a fresh opaque session cookie.
- `POST /api/v1/auth/logout` returns 204, revokes the current session, and clears the matching cookie.
- `GET /api/v1/auth/me` returns `{user:PublicUser}`.
- `POST /api/v1/auth/change-password` accepts `{currentPassword,newPassword}`, returns 204, revokes every user session, and clears the cookie.

- [ ] **Step 1: Write RED service and HTTP tests**

```ts
await anonymous
  .post("/api/v1/auth/login")
  .set("Origin", allowedOrigin)
  .set("X-CSRF-Protection", "1")
  .send(validCredentials)
  .expect(200);
expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
await anonymous.get("/api/v1/auth/me").expect(401);
await loggedIn.post("/api/v1/auth/logout").set(validCsrfHeaders).expect(204);
await loggedIn.get("/api/v1/auth/me").expect(401);
```

Tests cover local/public cookie attributes, generic invalid-credential behavior, identifier/source throttles including expiry, session idle/absolute expiry, disabled users, login fixation prevention, logout revocation, password rehash, and password-change revocation/audit.

- [ ] **Step 2: Run RED**

Run: `corepack pnpm vitest run apps/api/src/auth/auth.e2e-spec.ts apps/api/src/auth/auth.service.spec.ts`

Expected: FAIL because the auth endpoints/service are absent.

- [ ] **Step 3: Implement the minimal transactional auth flow**

Unknown-user verification uses a fixed non-account Argon2id dummy PHC string. Login success clears identifier throttle state, creates a new session, and audits without storing email/password/token. Failed paths use one public message; internal reason codes are allowlisted audit values.

- [ ] **Step 4: Run GREEN and API gates**

Run:

```powershell
corepack pnpm vitest run apps/api/src/auth
corepack pnpm --filter @yt-monitor/api typecheck
corepack pnpm --filter @yt-monitor/api build
corepack pnpm lint
corepack pnpm test
```

Expected: auth endpoint matrix and all unit gates PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/auth apps/api/src/app.module.ts
git commit -m "feat: add server side session authentication"
```

### Task 6: Implement ADMIN-only VIEWER management

**Files:**

- Create: `apps/api/src/users/users.controller.ts`, `users.service.ts`, `users.schemas.ts`
- Test: `apps/api/src/users/users.service.spec.ts`, `users.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**

- Implements every §71 route under `/api/v1/users` with the exact DTOs and lifecycle rules in this plan.
- Every route requires ADMIN. VIEWER receives 403/`AUTH_FORBIDDEN`; anonymous receives 401/`AUTH_UNAUTHENTICATED`.
- Create, email update, reset, revoke, disable, enable, and delete-alias operations append semantic audit rows atomically with the mutation.

- [ ] **Step 1: Write RED authorization/lifecycle tests**

```ts
await anonymous.get("/api/v1/users").expect(401);
await viewer.get("/api/v1/users").expect(403);
await admin.post("/api/v1/users").send(newViewer).expect(201);
await admin.post("/api/v1/users/admin-id/disable").expect(403);
await admin.delete("/api/v1/users/viewer-id").expect(204);
expect(await loadUser("viewer-id")).toMatchObject({ isEnabled: false });
```

Cover all nine §71 endpoints, validation, duplicate canonical email, stable pagination, disabled-session rejection, reset/revoke behavior, idempotent disable/enable, ADMIN-target protection, and secret-safe audits.

- [ ] **Step 2: Run RED**

Run: `corepack pnpm vitest run apps/api/src/users`

Expected: FAIL because the Users module is absent.

- [ ] **Step 3: Implement schemas, service transactions, controller**

Never accept a role field, never return `passwordHash`, and never hard-delete. `PATCH` rejects empty or extra-key bodies. Reset password uses the same policy and Argon2id implementation as self-change.

- [ ] **Step 4: Run GREEN and API gates**

Run:

```powershell
corepack pnpm vitest run apps/api/src/users apps/api/src/auth
corepack pnpm --filter @yt-monitor/api typecheck
corepack pnpm --filter @yt-monitor/api build
corepack pnpm lint
corepack pnpm test
```

Expected: endpoint/role/lifecycle tests and global unit gates PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/users apps/api/src/app.module.ts
git commit -m "feat: add viewer account administration"
```

### Task 7: Add the minimal Vietnamese authenticated Web experience

**Files:**

- Create: `apps/web/src/lib/api-client.ts`, `auth-context.tsx`, `auth-types.ts`
- Create: `apps/web/src/app/login/page.tsx` and focused components/tests
- Create: `apps/web/src/app/(authenticated)/layout.tsx`, `page.tsx`, `users/page.tsx` and tests
- Modify: `apps/web/src/app/page.tsx`, `layout.tsx`, `globals.css`

**Interfaces:**

- Same-origin client always sends credentials; unsafe JSON calls add `X-CSRF-Protection: 1`.
- Anonymous users are routed to `/login`. Authenticated users see a Vietnamese shell and system-foundation status. ADMIN sees `Người dùng`; VIEWER has no user-management action.
- Users screen supports server pagination, create VIEWER, change email, reset password, revoke sessions, disable/enable, and delete-as-disable with explicit Vietnamese confirmation/error states.

- [ ] **Step 1: Write RED component/client tests**

```tsx
expect(screen.getByRole("heading", { name: "Đăng nhập" })).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "Đăng nhập" }));
expect(fetchRequest.headers.get("X-CSRF-Protection")).toBe("1");
expect(screen.queryByRole("link", { name: "Người dùng" })).not.toBeInTheDocument();
```

Tests exercise the real components with a small HTTP boundary fake, not mocked child components. Cover loading, invalid credentials, forbidden, empty users, pagination, mutation errors, logout, and disabled-session redirect.

- [ ] **Step 2: Run RED**

Run: `corepack pnpm vitest run apps/web`

Expected: FAIL because login/authenticated/users UI modules are absent.

- [ ] **Step 3: Implement the minimal accessible Vietnamese UI**

Use semantic labels/buttons/tables, visible focus, status text with `aria-live`, and no fake monitoring metrics. Viewer dashboard states that channel/video data arrives in later collection phases.

- [ ] **Step 4: Run GREEN and Web gates**

Run:

```powershell
corepack pnpm vitest run apps/web
corepack pnpm --filter @yt-monitor/web typecheck
corepack pnpm --filter @yt-monitor/web build
corepack pnpm lint
corepack pnpm test
```

Expected: Web component tests, typecheck, build, and global unit gates PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web
git commit -m "feat: add Vietnamese login and users UI"
```

### Task 8: Verify Phase 1 with real PostgreSQL, Docker, and browser E2E

**Files:**

- Create: `playwright.config.ts`, `tests/e2e/auth-users.spec.ts`
- Create: `scripts/test-phase1-docker.ps1`
- Modify: `package.json`, `pnpm-lock.yaml`, `docker/Dockerfile`, `docker-compose.yml`
- Modify: `scripts/test-phase0-docker.ps1` for the Phase 1 liveness/admin-health contract
- Modify: `README.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `WORKLOG.md`, `IMPLEMENTATION_PLAN.md`

**Interfaces:**

- Adds exact-pinned `@playwright/test@1.62.1` and scripts `test:auth:integration`, `test:e2e`, `test:integration`, and `verify:phase1`.
- Adds a one-shot `db-seed` image/service profile. Only that process receives `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`.
- The isolated PowerShell test uses collision-resistant Compose names/ports/secrets, validates labels before cleanup, and removes only resources it created.

- [ ] **Step 1: Write the failing real-stack and browser acceptance gate**

The script must prove:

```text
clean migration deploy and repeat deploy
seed creates exactly one ADMIN and repeat seed is unchanged
no plaintext admin/viewer password or raw session token in database/logs
anonymous liveness 200; anonymous detailed health/protected route 401
ADMIN detailed health and every user write succeed
VIEWER read-only domain shell works and every §71 user endpoint is 403
disabled VIEWER loses an existing session
logout and password changes revoke sessions
cookie attributes are correct for LOCAL and PUBLIC API integration modes
CSRF hostile Origin/missing-header requests fail
Web/API/Worker/Postgres healthy; only Web has a loopback host binding
browser: ADMIN login → create VIEWER → VIEWER login → no Users action → ADMIN disable
no signup route
all isolated containers/networks/volumes/images are absent after cleanup
```

- [ ] **Step 2: Run RED**

Run: `corepack pnpm test:integration`

Expected: FAIL because Phase 1 Compose wiring, seed target, scripts, and browser E2E are incomplete.

- [ ] **Step 3: Complete Docker/env wiring, safe test orchestration, and documentation**

README quick start generates a random 32-byte `SESSION_SECRET`, requires the owner to choose admin email/password at seed time, runs migration/start, seeds once, and opens `http://127.0.0.1:3000/login`. It never prints or commits a credential. `WORKLOG.md` records commands/results without secret values.

- [ ] **Step 4: Run the complete Phase 1 gate**

Run:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:validate
corepack pnpm db:generate
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build
corepack pnpm test:integration
```

`test:integration` owns the isolated stack and invokes both `test:auth:integration`
with its temporary database URL and `test:e2e` with its temporary Web URL and
ephemeral credentials.

Expected: all commands exit 0; lint has zero warnings; auth integration and
browser E2E report zero failures; migration replay and cleanup assertions pass.

- [ ] **Step 5: Mark Phase 1 evidence and commit**

```powershell
git add playwright.config.ts tests/e2e scripts package.json pnpm-lock.yaml docker docker-compose.yml README.md docs WORKLOG.md IMPLEMENTATION_PLAN.md
git commit -m "feat: complete phase one authentication"
git status --short
```

## Phase 1 exit checklist

- [ ] ADMIN login and environment-only bootstrap work.
- [ ] ADMIN creates, edits, resets, revokes, disables, and enables VIEWER accounts.
- [ ] VIEWER can enter the authenticated read-only shell and cannot invoke user writes.
- [ ] Anonymous access is denied except minimal liveness and the login route.
- [ ] Detailed health requires ADMIN.
- [ ] No signup/OAuth/Google Login exists.
- [ ] Session, CSRF, throttle, revocation, audit, migration, Docker, and browser gates pass.
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass after the phase.
- [ ] Critical invariant traceability remains unchanged.
