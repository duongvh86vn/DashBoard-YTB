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

- Every `/api/v1/health*` route requires authenticated ADMIN. Docker checks the API listener from inside the API container with a bounded TCP probe; no anonymous HTTP liveness route is exposed through the Web rewrite. This preserves the critical invariant that public Internet access always requires login.
- The §103 anonymous analytics assertion is represented in Phase 1 by a default-deny protected-route test; the exact analytics URL assertion belongs to the phase that creates analytics routes. No fake analytics endpoint is added.
- User APIs manage VIEWER accounts only. ADMIN bootstrap is environment-only; APIs cannot create, promote, disable, reset, revoke, or delete an ADMIN.
- `POST /users` accepts `{email,password}` and creates VIEWER. `PATCH /users/:id` accepts only `{email}`. Password reset accepts `{password}`. `DELETE` has the same disable semantics as `POST /disable`.
- User list shape is `{items,page,pageSize,total}` with `page >= 1`, `1 <= pageSize <= 100`, ordered by `createdAt DESC, id DESC`.
- Email is trimmed and lowercased before persistence; password text is never normalized. Password policy is 12–128 Unicode code points.
- Argon2id parameters are version 1.3, 64 MiB memory, time cost 3, parallelism 1, 32-byte hash, and a library-generated salt of at least 16 bytes.
- Session tokens contain 32 CSPRNG bytes encoded base64url. PostgreSQL stores only `HMAC-SHA-256(SESSION_SECRET, token)`. Defaults are 120-minute idle and 24-hour absolute expiry.
- Local cookie: `yhm_session`, `Secure=false`. Public cookie: `__Host-yhm_session`, `Secure=true`. Both are host-only, `HttpOnly`, `SameSite=Lax`, `Path=/`, with no `Domain`.
- Unsafe requests require JSON content type, an exact allowed `Origin`, and `X-CSRF-Protection: 1`. CORS remains disabled and GET routes stay side-effect-free.
- Login throttling is PostgreSQL-backed and atomic for a normalized-identifier bucket. At 5 failures within 15 minutes the bucket is blocked for 15 minutes and returns `AUTH_RATE_LIMITED`; unknown, disabled, and wrong-password users otherwise share `AUTH_INVALID_CREDENTIALS`. The persisted SOURCE scope remains inactive until Phase 9 supplies a trustworthy, sanitized proxy/client-source boundary.
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

- Passwords are never normalized. `assertPasswordPolicy` accepts 12–128 Unicode
  code points and otherwise throws `AuthInputError` with
  `code: "VALIDATION_ERROR"`. `normalizeEmail` trims and lowercases only email.
- `hashPassword` uses Argon2id v1.3 with `memoryCost: 65_536` KiB,
  `timeCost: 3`, `parallelism: 1`, `hashLength: 32`, and the library-generated
  random salt (at least 16 bytes). `verifyPassword` returns
  `{valid:false,needsRehash:false}` for a wrong/malformed hash and reports
  `needsRehash` only after a valid verification.
- `createSessionCredential(secret, entropy?)` accepts an optional exact
  32-byte `Uint8Array` test entropy, returns a 43-character base64url token and
  its 32-byte `HMAC-SHA-256(SESSION_SECRET, token)` hash. Any non-32-byte test
  entropy is rejected. `hashSessionToken(secret,token)` returns the same hash.
- Session/expiry types are exact:

```ts
interface SessionExpiry {
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

interface SessionUsabilityInput {
  revokedAt: Date | null;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  userEnabled: boolean;
}
```

`calculateSessionExpiry(now,idleMinutes,absoluteHours)` sets both created/last
seen to copies of `now`, absolute expiry to `now + absoluteHours`, and idle
expiry to the earlier of `now + idleMinutes` and absolute expiry.
`isSessionUsable(input,now)` is true only when enabled, not revoked, and
`now` is strictly before both expiries; equality is expired.

- CSRF input is exact:

```ts
interface CsrfRequestInput {
  method: string;
  origin: string | undefined;
  contentType: string | undefined;
  protectionHeader: string | undefined;
  allowedOrigins: readonly string[];
}
```

`GET`, `HEAD`, and `OPTIONS` return true without headers. Every other method
requires exact origin membership, media type `application/json` (optional
charset parameters allowed), and protection header value exactly `"1"`.

- `canManageUsers(role)` is true only for `ADMIN`.
- Throttle types/semantics are exact:

```ts
interface ThrottleState {
  attemptCount: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
}

interface ThrottlePolicy {
  maxAttempts: number;
  windowMinutes: number;
  lockMinutes: number;
}
```

`nextThrottleState(null,now,policy)` starts at one failure. Before the window
boundary it increments; reaching `maxAttempts` sets `blockedUntil` to
`now + lockMinutes`. At the window boundary a non-blocked state resets to one.
A state with `blockedUntil > now` is returned unchanged; equality is unblocked.
`isThrottleBlocked(state,now)` uses that same strict boundary.

- `createSessionCookiePolicy(mode,absoluteHours)` returns exactly:

```ts
interface SessionCookiePolicy {
  name: "yhm_session" | "__Host-yhm_session";
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    path: "/";
    maxAge: number;
  };
}
```

`maxAge` is `absoluteHours * 60 * 60` seconds, `secure` is true only for
`PUBLIC`, and no `domain` property is present.

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

Use Node `randomBytes`/`createHmac`, the exact Argon2id parameters and boundary
semantics above, exact Origin comparison, and immutable date calculations.
The HMAC is a PostgreSQL lookup key, so Task 2 does not add an unused hash
comparison API. Cookie policy returns no `domain` field.

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
- Create: `packages/db/src/identity-records.ts`, `identity-errors.ts`, `identity-unit-of-work.ts`
- Create: `packages/db/src/user.repository.ts`, `session.repository.ts`, `login-throttle.repository.ts`, `audit-log.repository.ts`
- Test: matching unit and `*.integration.spec.ts` repository tests
- Create: `packages/db/src/seed-admin.ts`, `packages/db/src/seed-admin.spec.ts`, `prisma/seed.ts`
- Create: `scripts/test-phase1-db.ps1`
- Modify: `packages/db/package.json`, `package.json`

**Interfaces:**

- Adds these exact enums/models; the SQL migration uses the mapped snake-case
  table/column/index names and PostgreSQL `timestamptz(3)`/`uuid`/`bytea` types:

```prisma
enum UserRole {
  ADMIN
  VIEWER
}

enum LoginThrottleScope {
  IDENTIFIER
  SOURCE
}

enum AuditOutcome {
  SUCCESS
  FAILURE
}

enum AuditAction {
  LOGIN_SUCCEEDED
  LOGIN_FAILED
  LOGOUT
  PASSWORD_CHANGED
  USER_CREATED
  USER_EMAIL_CHANGED
  USER_PASSWORD_RESET
  USER_SESSIONS_REVOKED
  USER_DISABLED
  USER_ENABLED
  AUTHORIZATION_DENIED
}

model User {
  id           String    @id @default(uuid()) @db.Uuid
  email        String    @unique(map: "users_email_key") @db.VarChar(320)
  passwordHash String    @map("password_hash") @db.Text
  role         UserRole
  isEnabled    Boolean   @default(true) @map("is_enabled")
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  disabledAt   DateTime? @map("disabled_at") @db.Timestamptz(3)
  sessions     Session[]
  auditAsActor  AuditLog[] @relation("AuditActor")
  auditAsTarget AuditLog[] @relation("AuditTarget")

  @@index([role, isEnabled], map: "users_role_enabled_idx")
  @@map("users")
}

model Session {
  id               String    @id @default(uuid()) @db.Uuid
  userId           String    @map("user_id") @db.Uuid
  tokenHash        Bytes     @unique(map: "sessions_token_hash_key") @map("token_hash") @db.ByteA
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  lastSeenAt       DateTime  @map("last_seen_at") @db.Timestamptz(3)
  idleExpiresAt    DateTime  @map("idle_expires_at") @db.Timestamptz(3)
  absoluteExpiresAt DateTime @map("absolute_expires_at") @db.Timestamptz(3)
  revokedAt        DateTime? @map("revoked_at") @db.Timestamptz(3)
  revocationReason String?   @map("revocation_reason") @db.VarChar(64)
  user             User      @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@index([userId, revokedAt], map: "sessions_user_revoked_idx")
  @@index([idleExpiresAt], map: "sessions_idle_expiry_idx")
  @@index([absoluteExpiresAt], map: "sessions_absolute_expiry_idx")
  @@map("sessions")
}

model LoginThrottle {
  id              String             @id @default(uuid()) @db.Uuid
  scope           LoginThrottleScope
  keyHash         Bytes              @map("key_hash") @db.ByteA
  attemptCount    Int                @default(0) @map("attempt_count")
  windowStartedAt DateTime           @map("window_started_at") @db.Timestamptz(3)
  blockedUntil    DateTime?          @map("blocked_until") @db.Timestamptz(3)
  updatedAt       DateTime           @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@unique([scope, keyHash], map: "login_throttles_scope_key_hash_key")
  @@index([blockedUntil], map: "login_throttles_blocked_until_idx")
  @@map("login_throttles")
}

model AuditLog {
  id           String       @id @default(uuid()) @db.Uuid
  actorUserId  String?      @map("actor_user_id") @db.Uuid
  targetUserId String?      @map("target_user_id") @db.Uuid
  action       AuditAction
  outcome      AuditOutcome
  requestId    String?      @map("request_id") @db.VarChar(128)
  metadata     Json?
  createdAt    DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  actor        User?        @relation("AuditActor", fields: [actorUserId], references: [id], onDelete: SetNull)
  target       User?        @relation("AuditTarget", fields: [targetUserId], references: [id], onDelete: SetNull)

  @@index([actorUserId, createdAt(sort: Desc)], map: "audit_logs_actor_created_idx")
  @@index([targetUserId, createdAt(sort: Desc)], map: "audit_logs_target_created_idx")
  @@index([createdAt(sort: Desc)], map: "audit_logs_created_at_idx")
  @@map("audit_logs")
}
```

- `UserRecord` mirrors safe identity fields plus `passwordHash` for server-only
  services; `toPublicUser` is not a DB concern. All repository inputs use
  already-normalized email and already-hashed password/token values.
- `UserRepository` produces:

```ts
findById(id: string): Promise<UserRecord | null>;
findByCanonicalEmail(email: string): Promise<UserRecord | null>;
countAll(): Promise<number>;
countByRole(role: "ADMIN" | "VIEWER"): Promise<number>;
create(input: {email:string;passwordHash:string;role:"ADMIN"|"VIEWER"}): Promise<UserRecord>;
list(input: {page:number;pageSize:number}): Promise<{items:UserRecord[];total:number}>;
updateEmail(id: string, email: string): Promise<UserRecord>;
updatePasswordHash(id: string, passwordHash: string): Promise<void>;
setEnabled(id: string, enabled: boolean, now: Date): Promise<UserRecord>;
```

Duplicate email maps to `IdentityConflictError` with
`code: "USER_ALREADY_EXISTS"`; a missing ID maps to `IdentityNotFoundError`
with `code: "USER_NOT_FOUND"`. List order is `createdAt DESC, id DESC`.
`setEnabled(false,now)` sets `disabledAt=now`; `setEnabled(true,now)` clears
`disabledAt`.

- `SessionRepository` produces `create`, `findUsableByHash`, `touch`,
  `revokeById`, and `revokeAllForUser`. `findUsableByHash(hash,now)` requires
  `revokedAt=null`, both expiries strictly greater than `now`, and joined
  `user.isEnabled=true`; it returns the session plus current user role/state.
  `touch(id,now,requestedIdleExpiry)` sets `lastSeenAt=now` and idle expiry to
  the earlier of the requested value and the row's absolute expiry.
- `LoginThrottleRepository.get(scope,keyHash)` and
  `registerFailure(scope,keyHash,now,policy)` return `ThrottleState`;
  `clear(scope,keyHash)` is idempotent. `registerFailure` serializes each
  `(scope,keyHash)` with a transaction/advisory or row lock, applies Task 2's
  `nextThrottleState`, and cannot let concurrent fifth failures bypass the lock.
- `AuditLogRepository.append` accepts only enum action/outcome, nullable actor/
  target/request ID, and `Record<string,string|number|boolean|null> | null`.
  The repository is append-only and has no update/delete method.
- `IdentityUnitOfWork.transaction(work)` constructs User/Session/Audit
  repositories over one Prisma transaction at `Serializable` isolation so
  callers can commit a security mutation and semantic audit atomically.
- `seedInitialAdmin({email,password}, dependencies)` normalizes/validates and
  hashes through `@yt-monitor/auth`. Under a transaction-wide advisory lock:
  empty identity store creates one active ADMIN; exactly one matching active
  ADMIN returns `{status:"UNCHANGED"}` without verifying/resetting its password;
  any users without an ADMIN, a different ADMIN email, a matching VIEWER, a
  disabled ADMIN, or multiple ADMIN rows throws `SeedAdminConflictError` with
  `code:"SEED_ADMIN_CONFLICT"`. Concurrent empty-database runs converge to one
  ADMIN. The CLI reads only `DATABASE_URL`, `SEED_ADMIN_EMAIL`, and
  `SEED_ADMIN_PASSWORD`, prints only `CREATED`/`UNCHANGED`, and disconnects.
- `prisma.config.ts` sets `migrations.seed: "tsx prisma/seed.ts"`; root script
  `db:seed` is `prisma db seed`. `@yt-monitor/db` depends on
  `@yt-monitor/auth`.
- `scripts/test-phase1-db.ps1` creates a collision-resistant
  `ytmonitor-authdb-$PID-<8 hex>` Compose project, random database password and
  schema, starts only Postgres, builds/runs `db-migrate`, deploys migrations
  twice, invokes the DB integration suite and seed twice, validates exact
  project labels before cleanup, and removes only its own containers/networks/
  volumes/images in `finally`. No generated secret value is printed.

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

Integration tests prove atomic fifth-failure blocking under concurrent calls,
revoked/disabled sessions are unusable, pagination ordering is stable, audit
rows contain no planted credential markers, migration replay is safe, and ADMIN
bootstrap cannot silently promote/reset/re-enable.

- [ ] **Step 2: Run RED**

Run:
`corepack pnpm db:generate && corepack pnpm vitest run packages/db/src/seed-admin.spec.ts packages/db/src/user.repository.spec.ts`

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
corepack pnpm test:auth:integration
corepack pnpm lint
corepack pnpm test
```

Expected: schema, repository/seed tests, and global unit gates PASS.

- [ ] **Step 5: Commit**

```powershell
git add prisma packages/db scripts/test-phase1-db.ps1 package.json
git commit -m "feat: persist users sessions and audit history"
```

### Task 4: Establish the default-deny API security pipeline and protected health

**Files:**

- Create: `apps/api/src/auth/public.decorator.ts`, `roles.decorator.ts`, `request-user.ts`
- Create: `apps/api/src/auth/session-authentication.port.ts`, `auth-policy.error.ts`
- Create: `apps/api/src/auth/session.guard.ts`, `roles.guard.ts`, `csrf.guard.ts`, `auth-exception.filter.ts`
- Create: `apps/api/src/auth/security-pipeline.e2e.spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/main.ts`
- Modify: `apps/api/src/health/health.controller.ts` and health HTTP tests
- Modify: `apps/api/package.json`, `pnpm-lock.yaml`, `docker-compose.yml`

**Interfaces:**

- Task 4 owns this port; Task 5 implements it without redefining the token or
  principal shape:

```ts
export interface RequestSession {
  id: string;
}

export interface AuthenticatedPrincipal {
  user: PublicUser;
  session: RequestSession;
}

export interface SessionAuthenticationPort {
  authenticate(token: string): Promise<AuthenticatedPrincipal | null>;
}

export interface AuthenticatedRequest extends Request {
  user: PublicUser;
  session: RequestSession;
}

export const SESSION_AUTHENTICATION_PORT = Symbol("SESSION_AUTHENTICATION_PORT");
```

- The request principal contains only safe `PublicUser` fields and session ID;
  raw cookie/token, token hash, password hash, and DB session rows never attach
  to the request. A Task 4 deny-all implementation returns `null`; Task 5 swaps
  in the PostgreSQL authenticator.
- `@Public()` sets boolean metadata. `@Roles(...roles)` accepts a non-empty tuple
  of `UserRoleValue`. Handler metadata overrides controller metadata; roles do
  not merge. No `@Public()` means protected, no `@Roles()` means any
  authenticated role, and public wins if public and roles coexist. `@Public()`
  skips only session and role guards; it never skips CSRF.
- The active deployment mode selects exactly one accepted request cookie:
  `yhm_session` for LOCAL or `__Host-yhm_session` for PUBLIC. The other-mode
  cookie cannot authenticate. `apps/api` adds the direct exact dependency
  `cookie@2.0.1`; it does not rely on a transitive package or add cookie-parser.
- Missing, empty, malformed, wrong-mode, invalid, expired, revoked, and
  disabled-user sessions all produce the same public unauthenticated result.
  The authentication port returns `null` for ordinary invalid-session states;
  infrastructure/programming exceptions propagate as non-auth failures and
  their messages are never copied into the public response.
- Register `APP_GUARD` providers in the exact observable order session → roles →
  CSRF. An anonymous unsafe protected request stops at 401; an authenticated
  wrong-role unsafe request stops at role 403; only an authorized or public
  unsafe request reaches CSRF validation. Guards throw dedicated policy errors
  rather than returning `false` and accepting Nest's default envelope.
- The global CSRF guard passes the raw method, Origin, Content-Type,
  `x-csrf-protection`, and `env.APP_ALLOWED_ORIGINS` to Task 2's validator.
  Every unsafe request, including Task 5 login and zero-body logout/user
  actions, requires exact allowed Origin, JSON content type, and header value
  `"1"`. CORS stays disabled.
- Freeze exact auth-policy responses with `Cache-Control: no-store` and no extra
  keys:

```json
HTTP 401
{"error":{"code":"AUTH_UNAUTHENTICATED","message":"Authentication required"}}

HTTP 403 — role
{"error":{"code":"AUTH_FORBIDDEN","message":"Forbidden"}}

HTTP 403 — CSRF
{"error":{"code":"AUTH_CSRF_INVALID","message":"Invalid CSRF request"}}
```

- `AuthExceptionFilter` catches only the dedicated `AuthPolicyError`. It must
  preserve unrelated Nest exceptions and the existing detailed-health 503
  bodies exactly.
- `AppModule` has no module-evaluation read of `process.env`, Prisma creation,
  or repository/pool side effect. It exposes exact dynamic entrypoints:

```ts
export interface ProductionAppModuleOptions {
  env: ApiEnv,
  databaseClient: DatabaseClient,
  sessionAuthenticator?: SessionAuthenticationPort,
}

export interface TestingAppModuleOptions {
  env: ApiEnv,
  databaseHealthReader: DatabaseHealthReader,
  workerHeartbeatReader: WorkerHeartbeatReader,
  sessionAuthenticator?: SessionAuthenticationPort,
}

AppModule.forProduction(options: ProductionAppModuleOptions): DynamicModule;
AppModule.forTesting(options: TestingAppModuleOptions): DynamicModule;
```

Both omitted authenticators fail closed. `forTesting` never requires or
constructs Prisma. `DatabaseLifecycle` is production-only.

- `main.ts` parses process environment exactly once, creates exactly one Prisma
  client, builds `AppModule.forProduction`, installs Pino and shutdown hooks,
  sets prefix `api/v1`, keeps CORS disabled, and binds `0.0.0.0:API_PORT`. If
  bootstrap fails after client creation it closes the app/client before
  returning failure.
- `HealthController` has controller-level `@Roles("ADMIN")`. The protected set
  is exactly `GET /api/v1/health`, `/health/db`, `/health/worker`,
  `/health/collectors`, and `/health/ai`; their Phase 0 schemas, 200/503
  behavior, deadlines, and `Cache-Control: no-store` remain unchanged.
- Docker replaces the authenticated HTTP healthcheck with a bounded TCP
  listener probe to `127.0.0.1:5000` inside the API container. This is process
  readiness, not DB readiness; migrations still gate API startup. Task 4 does
  not add the remaining auth environment wiring owned by Task 8.

- [ ] **Step 1: Write RED HTTP policy tests**

```ts
await request(app.getHttpServer()).get("/api/v1/health/db").expect(401);
await authenticatedViewer.get("/api/v1/health/db").expect(403);
await authenticatedAdmin.get("/api/v1/health/db").expect(200);
await request(app.getHttpServer()).get("/api/v1/test-protected").expect(401);
```

Use `AppModule.forTesting` with no valid process auth/DB environment and no
Prisma. The protected probe and unsafe policy probes exist only in the test
module. Tests must cover:

- all five detailed health paths: anonymous exact 401, VIEWER exact 403, ADMIN
  preserves the existing 200/503 body;
- omitted authenticator with a valid-looking active-mode cookie still returns
  401;
- fake invalid/expired/revoked/disabled tokens return `null` and receive the
  identical exact 401 without planted token/cookie/database markers;
- malformed and wrong-mode cookies receive the same 401;
- success attaches exactly `user` and `{id}` session to the protected probe;
- public unsafe probe still enforces CSRF;
- guard precedence: anonymous unsafe ADMIN route + bad CSRF → 401, VIEWER + bad
  CSRF → role 403, ADMIN + bad CSRF → CSRF 403;
- handler metadata overrides controller roles and public wins over roles;
- an authenticated ADMIN health 503 retains the Phase 0 health schema, proving
  the auth filter does not wrap unrelated exceptions;
- importing/composing the testing module has no environment or database side
  effect.

- [ ] **Step 2: Run RED**

Run: `corepack pnpm vitest run apps/api/src/auth/security-pipeline.e2e.spec.ts apps/api/src/health/health.e2e.spec.ts`

Expected: FAIL because the ports, guards, policy errors, dynamic composition,
and protected health metadata are absent.

- [ ] **Step 3: Implement global guards/filter and refactor module composition**

Implement only the frozen boundary above. Do not implement Task 5's database
session authenticator or auth controllers early. The deny-all production
fallback keeps every protected route closed until Task 5 installs the real
adapter.

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
git add apps/api package.json pnpm-lock.yaml docker-compose.yml
git commit -m "feat: enforce default deny API security"
```

### Task 5: Implement login, logout, current-user, and password-change endpoints

**Files:**

- Create: `apps/api/src/auth/auth.controller.ts`, `auth.service.ts`, `auth.schemas.ts`
- Create: `apps/api/src/auth/auth-application.port.ts`, `auth-application.error.ts`, and the narrowly matching application exception filter
- Create: `apps/api/src/auth/session-authenticator.ts`, `session-cookie.service.ts`, `login-throttle.service.ts`, and deterministic clock/entropy/password ports as needed
- Test: `auth.schemas.spec.ts`, `session-authenticator.spec.ts`, `session-cookie.service.spec.ts`, `login-throttle.service.spec.ts`, `auth.service.spec.ts`, `auth.e2e.spec.ts`, `auth.integration.spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/package.json`, `pnpm-lock.yaml`
- Modify: `packages/db/src/user.repository.ts`, `session.repository.ts`, `login-throttle.repository.ts`, `identity-unit-of-work.ts`, exports, and focused unit/integration tests

**Interfaces:**

- Exact HTTP contract; every success and known error uses
  `Cache-Control: no-store`:

| Route                               | Access and strict input                                                                     | Success                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `POST /api/v1/auth/login`           | the only production `@Public()` route; global CSRF still applies; strict `{email,password}` | `200 {"user":PublicUser}` plus one fresh active-mode cookie       |
| `POST /api/v1/auth/logout`          | any authenticated role; absent body or exact `{}` only                                      | `204`, empty body, current session revoked, active cookie cleared |
| `GET /api/v1/auth/me`               | any authenticated role; no body                                                             | `200 {"user":PublicUser}` from the safe request principal         |
| `POST /api/v1/auth/change-password` | any authenticated role; strict `{currentPassword,newPassword}`                              | `204`, empty body, all sessions revoked, active cookie cleared    |

- `apps/api` adds the direct exact dependency `zod@4.4.3`. Zod checks only
  strict object shape, required keys, and string types. Logout has no semantic
  body: accept an absent body or exact `{}`, reject any non-empty object,
  primitive, or array; Task 4 still requires JSON Content-Type for this unsafe
  request. Email is trimmed/lowercased in the service. Invalid email syntax or
  normalized length greater than 320 follows the credential/throttle path,
  never a validation 400. Login password and current password do not apply the
  account-creation minimum before verification; any wrong string is a generic
  credential result. Password text is never trimmed or normalized. Only a new
  password applies Task 2's 12–128 Unicode code-point creation policy.
  Structurally invalid JSON/DTOs and new-password policy failures return exactly:

```json
HTTP 400
{"error":{"code":"VALIDATION_ERROR","message":"Invalid request"}}
```

All Nest `BadRequestException` values are mapped to this same exact 400; the
filter does not attempt to infer which body parser generated the exception.
Malformed JSON is rejected by middleware before guards, so auth/CSRF precedence
assertions below use syntactically valid JSON.

- Freeze the other exact application errors with no extra response keys:

```json
HTTP 401 — login
{"error":{"code":"AUTH_INVALID_CREDENTIALS","message":"Invalid email or password"}}

HTTP 401 — wrong current password
{"error":{"code":"AUTH_INVALID_CREDENTIALS","message":"Current password is incorrect"}}

HTTP 429
{"error":{"code":"AUTH_RATE_LIMITED","message":"Too many login attempts"}}
```

A 429 includes integer `Retry-After = ceil((blockedUntil-now)/1000)`, minimum
one second. The new application filter catches only its dedicated error plus
every `BadRequestException`; it must not wrap Task 4 policy errors, health 503s,
or infrastructure failures.

- With syntactically valid JSON, precedence is observable: login with bad CSRF
  returns Task 4 CSRF 403 before DTO/service work; anonymous unsafe logout/
  change-password returns 401 before CSRF; authenticated unsafe logout/
  change-password reaches CSRF. `/me`, logout, change-password, health, and all
  future routes remain default-deny.

**Task 5 database correction:**

- Refactor the throttle implementation into a transaction-scoped repository
  over Prisma's transaction client plus the existing root wrapper. Preserve
  the existing public root API `get`, `registerFailure`, and `clear`. The new
  transaction repository exposes `getLocked`, `registerFailure`, and `clear`;
  all three acquire the same exact Task 3 per-key advisory lock without opening
  a nested transaction. Root mutation methods delegate through their own
  transaction. `IdentityRepositories` now includes `throttles`, so throttle
  mutation and audit/session changes share one Serializable transaction.
- `UserRepository.findByIdForSecurityUpdate(id)` takes a transaction-scoped
  advisory lock keyed by the user ID and returns the current row. Login success,
  self password change, and every Task 6 reset/disable/enable mutation must use
  this same primitive. After password verification the transaction rechecks
  `isEnabled`, canonical email equality, and the exact verified password-hash
  state before creating a session or changing credentials. This prevents a
  login verified against an old email/password from creating a session after a
  concurrent rename/reset/revoke.
- `SessionRepository.create` persists `createdAt: input.now` as well as
  `lastSeenAt: input.now`; injected clocks therefore control the complete
  expiry record. No migration/schema change is needed.
- Security transactions stay `Serializable`. Retry exactly once and only when
  Prisma reports `P2034` (serialization/write-conflict or deadlock); every other
  programming/infrastructure error propagates without retry. Tests with the real
  PostgreSQL adapter prove rollback and race behavior rather than claiming
  atomicity from fakes.

**Session authentication and cookies:**

- Task 4 continues to parse the raw Cookie header and pass only a validated
  43-character active-mode token. The concrete `SessionAuthenticator`
  implements Task 4's existing port; it never parses Request/cookies itself.
- Capture the injected clock once, HMAC the token with `SESSION_SECRET`, call
  `findUsableByHash(hash,now)`, and return `null` without touch on any miss,
  revoke, equality/expiry, or disabled-user state. On a hit, touch to
  `min(now + SESSION_IDLE_MINUTES, absoluteExpiresAt)` and return only
  `{user:PublicUser,session:{id}}`. A failed touch returns `null`; DB/programming
  exceptions propagate. No raw token/hash/DB row enters the principal or log.
- Login always generates a new 32-byte credential and never adopts an incoming
  cookie. Set only the active mode name using Task 2's host-only `HttpOnly`,
  `SameSite=Lax`, `Path=/`, mode-specific `Secure`, and absolute `Max-Age`
  policy. Clear only that name after a successful logout/password-change commit
  with the same attributes plus `Max-Age=0` and Unix-epoch `Expires`; never set
  `Domain`.

**Login and throttle flow:**

- `LoginThrottleService` derives only this 32-byte, domain-separated key and
  never stores/logs raw email:

```text
HMAC-SHA-256(SESSION_SECRET, "login-throttle:identifier:v1\0" + canonicalEmail)
```

Use `LOGIN_MAX_ATTEMPTS`, a fixed 15-minute window, and
`LOGIN_LOCK_MINUTES`. `blockedUntil > now` is blocked; equality is unblocked.
The fifth failed attempt creates the block and itself returns 429. A blocked
bucket is rechecked while holding its key lock before login success and is
not cleared early. Successful login clears the identifier bucket in the same
transaction as optional rehash, session creation, and success audit.

- Do not derive or trust a source bucket from `X-Forwarded-For`, `req.ip`, or the
  API socket in Phase 1: Next 16 preserves a supplied forwarding header while
  the API socket sees the shared Web proxy. SOURCE activation belongs to Phase
  9 after proxy sanitization/trust tests; Task 5 must not claim it is active.
- Unknown identifiers perform one verification against this fixed non-account
  Argon2id PHC before returning the same public error:

```text
$argon2id$v=19$m=65536,p=1,t=3$WUhNLWR1bW15LXYxLXNhbHQ$j4f7wiVxLcRxDd1+QepaC+f3tRFUpYYLkNZ8iitDVb4
```

Disabled users still perform real verification; wrong/malformed hashes never
rehash. Valid credentials with `needsRehash=true` compute a Task 2 replacement
hash, then recheck the locked enabled/email/password-hash state before storing
it. Email or credential state changing during verification causes one bounded
full retry from canonical lookup; a second change fails generically, audits
`CREDENTIAL_STATE_CHANGED`, and never creates a session.

- A transaction that must persist throttle/audit state returns a discriminated
  committed outcome; throw the public `AuthApplicationError` only after the UoW
  resolves. Never throw public 401/429 from inside a transaction whose
  throttle/audit writes must commit.
- A pre-existing blocked bucket runs a short transaction that `getLocked`s,
  appends `LOGIN_FAILED/FAILURE` with `THROTTLED_IDENTIFIER`, commits, then
  returns 429 without Argon work or another attempt increment. Attempts 1–4
  register the failure and audit the actual `UNKNOWN_IDENTIFIER`,
  `INVALID_PASSWORD`, or `USER_DISABLED` reason. The fifth failure registers
  the blocked state and audits `THROTTLED_IDENTIFIER`, commits, then returns 429. Valid credentials recheck the bucket inside the success transaction; a
  block that committed first is audited and preserved with no clear/session. If
  success commits first, a later failure leaves attempt one. Thus concurrent
  failure/success outcomes are linearizable under the same key lock.

**Logout, password change, and audit:**

- Use injected `Clock`, 32-byte entropy source, and password hash/verify ports;
  service tests never call ambient time/randomness. `requestId` remains `null`
  in Phase 1 rather than trusting a client header.
- Exact semantic rows and allowlisted metadata:

| Event                  | Atomic row/mutation                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| login success          | `LOGIN_SUCCEEDED/SUCCESS`, actor=target=user, `{passwordRehashed:boolean}` with identifier clear + optional rehash + session create                                                          |
| login failure          | `LOGIN_FAILED/FAILURE`, actor null, target known user or null, `{reason}` from `UNKNOWN_IDENTIFIER`, `INVALID_PASSWORD`, `USER_DISABLED`, `THROTTLED_IDENTIFIER`, `CREDENTIAL_STATE_CHANGED` |
| logout                 | `LOGOUT/SUCCESS`, actor=target=current user, metadata null with `revokeById(session.id,now,"logout")`                                                                                        |
| wrong current password | `PASSWORD_CHANGED/FAILURE`, actor=target=self, `{reason:"INVALID_CURRENT_PASSWORD"}` and no password/session mutation                                                                        |
| password change        | `PASSWORD_CHANGED/SUCCESS`, actor=target=self, `{revokedSessionCount:number}` with locked password update + `revokeAllForUser(...,"password-changed")`                                       |

Cookie set/clear occurs only after its database transaction commits. Any DB
failure leaves the browser cookie unchanged. Audit metadata never includes
email, IP, password, cookie, raw token, token hash, or password hash.

- Self password change uses the same user-security lock. A missing/disabled user
  under that lock performs no mutation. If the password hash changed after the
  first verification, redo the complete current-password verification once;
  if it no longer matches, commit only the failure audit and return the exact
  wrong-current-password 401 after the transaction resolves.

**Application port and module composition:**

- Freeze the controller port and injection token:

```ts
export const AUTH_APPLICATION_PORT = Symbol("AUTH_APPLICATION_PORT");

export interface AuthApplicationPort {
  login(input: {
    email: string;
    password: string;
  }): Promise<{ user: PublicUser; sessionToken: string }>;
  logout(input: { userId: string; sessionId: string }): Promise<void>;
  changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void>;
}
```

- Add an injectable `AuthApplicationPort` for the controller. Production
  `AppModule.forProduction` wires real repositories/UoW/AuthService from its
  one provided database client. Testing composition accepts an optional fake
  through exact additive option `authApplication?: AuthApplicationPort` and
  never constructs Prisma. Its omitted service never returns success, a session
  token, or a mutation, so it fails closed.
- Task 4's omitted `sessionAuthenticator` behavior remains deny-all.
  `main.ts` creates the concrete `SessionAuthenticator` from the same one
  Prisma client and passes it explicitly to `forProduction`; it must not leave
  production permanently deny-all or create a second client.

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

Unit/HTTP tests cover structural validation, exact error/no-store bodies,
CSRF/auth precedence, identifier throttle fifth-attempt/equality/expiry,
domain-separated HMAC privacy, dummy verification, disabled/wrong users,
fixation prevention, cookie modes, session strict expiry/touch, rehash, rollback,
audit allowlists, logout, and current-password failure/success. Real
`auth.integration.spec.ts` covers HMAC-only session storage, transactional
throttle clear/failure races, login-versus-credential-reset locking, rehash
persistence, login-versus-email-rename locking, logout/password-change
revoke+audit atomicity, and planted-secret absence.

- [ ] **Step 2: Run RED**

Run:

```powershell
corepack pnpm vitest run apps/api/src/auth/auth.schemas.spec.ts apps/api/src/auth/session-authenticator.spec.ts apps/api/src/auth/session-cookie.service.spec.ts apps/api/src/auth/login-throttle.service.spec.ts apps/api/src/auth/auth.service.spec.ts apps/api/src/auth/auth.e2e.spec.ts
corepack pnpm vitest run packages/db/src/user.repository.spec.ts packages/db/src/session.repository.spec.ts packages/db/src/login-throttle.repository.spec.ts packages/db/src/identity-unit-of-work.spec.ts
```

Expected: FAIL because the auth endpoints/service are absent.

- [ ] **Step 3: Implement the minimal transactional auth flow**

Implement the minimal frozen contracts above. Do not add signup, remember-me,
refresh tokens, bearer auth, source-IP trust, ADMIN management, or Web UI early.

- [ ] **Step 4: Run GREEN and API gates**

Run:

```powershell
corepack pnpm vitest run apps/api/src/auth
corepack pnpm --filter @yt-monitor/api typecheck
corepack pnpm --filter @yt-monitor/api build
corepack pnpm test:auth:integration
corepack pnpm lint
corepack pnpm test
```

Expected: auth endpoint matrix and all unit gates PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api packages/db pnpm-lock.yaml
git commit -m "feat: add server side session authentication"
```

### Task 6: Implement ADMIN-only VIEWER management

**Files:**

- Create: `apps/api/src/users/users-application.port.ts`, `apps/api/src/users/user-application.error.ts`
- Create: `apps/api/src/users/users.controller.ts`, `users.service.ts`, `users.schemas.ts`
- Test: `apps/api/src/users/users.schemas.spec.ts`, `users.service.spec.ts`, `users.e2e.spec.ts`, `users.integration.spec.ts`
- Modify: `apps/api/src/auth/auth-application-exception.filter.ts`, `apps/api/src/app.module.ts`
- Modify/Test: `packages/auth/src/contracts.ts`, `packages/auth/src/contracts.spec.ts`
- Modify/Test: `packages/db/src/user.repository.ts`, `packages/db/src/user.repository.spec.ts`

**Interfaces:**

- Implements the eight, and only the eight, §71 routes under `/api/v1/users`. There is no `GET /users/:id` route.
- Every route has `@Roles("ADMIN")`. Anonymous receives exact 401/`AUTH_UNAUTHENTICATED`; a VIEWER caller receives exact 403/`AUTH_FORBIDDEN` before request validation.
- Existing ADMIN rows are protected targets for `PATCH`, reset, revoke, disable, enable, and `DELETE`, including self-targets. The service commits an `AUTHORIZATION_DENIED` audit before returning exact 403/`AUTH_FORBIDDEN`; it never mutates an ADMIN.
- All successful and known-error responses use `Cache-Control: no-store`. `PublicUser` timestamps are ISO strings and neither password nor hash/session fields are returned.

Exact transport contract:

| Method/path                              | Strict input                                                                                                                                 | Success                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `GET /api/v1/users`                      | query keys only `page`, `pageSize`; defaults `1`, `20`; positive safe decimal integers; `pageSize <= 100`; reject unknown or repeated values | `200 {items:PublicUser[],page,pageSize,total}` |
| `POST /api/v1/users`                     | `{email:string,password:string}`                                                                                                             | `201 {user:PublicUser}`                        |
| `PATCH /api/v1/users/:id`                | UUID; `{email:string}`                                                                                                                       | `200 {user:PublicUser}`                        |
| `POST /api/v1/users/:id/reset-password`  | UUID; `{password:string}`                                                                                                                    | `204`, empty                                   |
| `POST /api/v1/users/:id/revoke-sessions` | UUID; absent body or exact `{}`                                                                                                              | `204`, empty                                   |
| `POST /api/v1/users/:id/disable`         | UUID; absent body or exact `{}`                                                                                                              | `204`, empty                                   |
| `POST /api/v1/users/:id/enable`          | UUID; absent body or exact `{}`                                                                                                              | `204`, empty                                   |
| `DELETE /api/v1/users/:id`               | UUID; absent body or exact `{}`                                                                                                              | `204`, empty; exact disable alias              |

Unsafe routes retain the Task 4 guard contract: JSON content type, exact allowed `Origin`, and `X-CSRF-Protection: 1`, including zero-semantic-body actions. Email is trimmed/lowercased and then validated as a maximum-320-character email; passwords are not normalized and use the 12–128 Unicode-code-point policy. Primitive/array bodies, unknown keys, `role`, empty `PATCH`, invalid UUID/query/email/password, and non-empty action bodies are exact 400/`VALIDATION_ERROR`.

The list contains VIEWER rows only, both enabled and disabled, ordered by `createdAt DESC, id DESC`; `items` and VIEWER-only `total` are read in one Serializable transaction snapshot. Offset pagination is deterministic per snapshot, not promised stable across separate requests with concurrent inserts.

For syntactically valid JSON, precedence is session 401, caller-role 403, CSRF 403, request validation 400, locked target lookup (missing 404, ADMIN target 403), then canonical-email conflict 409. Malformed JSON may be rejected by the body parser before guards, as frozen in Task 5. Exact additional errors are 404/`USER_NOT_FOUND`/`User not found` and 409/`USER_ALREADY_EXISTS`/`A user with that email already exists`.

The controller depends only on this frozen application port:

```ts
export const USERS_APPLICATION_PORT = Symbol("USERS_APPLICATION_PORT");

export interface UsersApplicationPort {
  list(input: { page: number; pageSize: number }): Promise<{
    items: PublicUser[];
    page: number;
    pageSize: number;
    total: number;
  }>;
  create(input: { actorUserId: string; email: string; password: string }): Promise<PublicUser>;
  updateEmail(input: {
    actorUserId: string;
    targetUserId: string;
    email: string;
  }): Promise<PublicUser>;
  resetPassword(input: {
    actorUserId: string;
    targetUserId: string;
    password: string;
  }): Promise<void>;
  revokeSessions(input: { actorUserId: string; targetUserId: string }): Promise<void>;
  disable(input: {
    actorUserId: string;
    targetUserId: string;
    via: "DISABLE_ENDPOINT" | "DELETE_ALIAS";
  }): Promise<void>;
  enable(input: { actorUserId: string; targetUserId: string }): Promise<void>;
}
```

`TestingAppModuleOptions` gains additive optional `usersApplication?: UsersApplicationPort`; omission fails closed without constructing Prisma. Production constructs the real Auth and Users services from the same explicitly provided database client and shared `IdentityUnitOfWork`, clock, and password port. Extend the existing application exception filter rather than registering an ambiguously ordered second global filter.

Every target operation, including email update and session revoke, first calls `findByIdForSecurityUpdate` inside the same UoW transaction used by Task 5 login. This linearizes session creation against reset/revoke/disable: if login wins, the later mutation revokes its session; if the mutation wins, a genuinely later login may create a new session only when the resulting user state permits it. All security transactions use the shared Serializable UoW and retry exactly once only for Prisma `P2034`.

Capture the clock once per service call. Validate and Argon2-hash create/reset passwords exactly once outside the transaction/user lock and reuse the hash/time on a P2034 retry. Create is not idempotent; a canonical duplicate is always 409. Same-canonical email update is state-idempotent, does not change `updatedAt`, and audits `changed:false`. Reset intentionally creates a new hash and revokes every session on every success. Revoke is idempotent. Disable and `DELETE` are idempotent state transitions but always ensure all sessions are revoked. Enable is idempotent, never restores a revoked session, and requires a new login.

Audit rows are allowlisted, use `requestId:null`, and commit atomically:

| Operation              | Action/outcome                  | Metadata                                               |
| ---------------------- | ------------------------------- | ------------------------------------------------------ |
| create VIEWER          | `USER_CREATED/SUCCESS`          | `null`                                                 |
| email update           | `USER_EMAIL_CHANGED/SUCCESS`    | `{changed}`                                            |
| reset password         | `USER_PASSWORD_RESET/SUCCESS`   | `{revokedSessionCount}`                                |
| revoke sessions        | `USER_SESSIONS_REVOKED/SUCCESS` | `{revokedSessionCount}`                                |
| disable endpoint       | `USER_DISABLED/SUCCESS`         | `{changed,revokedSessionCount,via:"DISABLE_ENDPOINT"}` |
| delete alias           | `USER_DISABLED/SUCCESS`         | `{changed,revokedSessionCount,via:"DELETE_ALIAS"}`     |
| enable                 | `USER_ENABLED/SUCCESS`          | `{changed}`                                            |
| protected ADMIN target | `AUTHORIZATION_DENIED/FAILURE`  | `{operation,reason:"ADMIN_TARGET_PROTECTED"}`          |

Actor is always the authenticated ADMIN; target is the affected VIEWER or protected ADMIN. For protected-target audits, `operation` is exactly one of `UPDATE_EMAIL`, `RESET_PASSWORD`, `REVOKE_SESSIONS`, `DISABLE`, `ENABLE`, or `DELETE_ALIAS`. Validation, missing-target, and duplicate-email failures do not append semantic mutation audits. ADMIN-target denial uses Task 5's committed-outcome pattern: throw the public 403 only after the UoW resolves. Metadata never contains email, password, hashes, tokens/cookies, IP, or secrets.

- [ ] **Step 1: Write RED authorization/lifecycle tests**

```ts
await anonymous.get("/api/v1/users").expect(401);
await viewer.get("/api/v1/users").expect(403);
await admin.post("/api/v1/users").send(newViewer).expect(201);
await admin.post("/api/v1/users/admin-id/disable").send({}).expect(403);
await admin.delete("/api/v1/users/viewer-id").send({}).expect(204);
expect(await loadUser("viewer-id")).toMatchObject({ isEnabled: false });
```

Unit/service tests use fake UoW, clock, and password ports to prove validation, precedence, idempotency, hash-once retry, committed denial audit, rollback behavior, and allowlisted metadata. HTTP tests use `AppModule.forTesting` plus a fake Users port and cover all eight routes, guards/CSRF, exact schemas/statuses/errors/headers, VIEWER-only serialization, and fail-closed omission. Repository tests prove VIEWER filtering, order, and same-transaction page/count behavior.

Real PostgreSQL integration covers concurrent canonical create, audit rollback, tied pagination/filtering, reset/revoke/disable races with login, old-email login racing canonical rename, and re-enable not resurrecting revoked sessions. Plant sentinel credentials/tokens and assert none appears in audit metadata or returned payloads.

- [ ] **Step 2: Run RED**

Run:

```powershell
corepack pnpm vitest run apps/api/src/users/users.schemas.spec.ts apps/api/src/users/users.service.spec.ts apps/api/src/users/users.e2e.spec.ts packages/db/src/user.repository.spec.ts
corepack pnpm test:auth:integration
```

Expected: focused suites FAIL because the Users module/contracts are absent; the real-PostgreSQL gate fails once the new integration cases are present but production behavior is missing.

- [ ] **Step 3: Implement schemas, service transactions, controller**

Add `VALIDATION_ERROR`, `USER_NOT_FOUND`, and `USER_ALREADY_EXISTS` to the browser-safe error-code union. Add a VIEWER-filtered repository page primitive; do not weaken or silently repurpose an all-role method used by bootstrap. Never add hard-delete or role-update repository/application methods and do not add a schema migration or audit enum.

- [ ] **Step 4: Run GREEN and API gates**

Run:

```powershell
corepack pnpm vitest run apps/api/src/users apps/api/src/auth
corepack pnpm vitest run packages/db/src/user.repository.spec.ts
corepack pnpm --filter @yt-monitor/db typecheck
corepack pnpm --filter @yt-monitor/api typecheck
corepack pnpm --filter @yt-monitor/api build
corepack pnpm test:auth:integration
corepack pnpm lint
corepack pnpm test
```

Expected: exact endpoint/role/lifecycle tests, real PostgreSQL races, typechecks/build, and global unit/lint gates PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/users apps/api/src/auth/auth-application-exception.filter.ts apps/api/src/app.module.ts packages/auth/src/contracts.ts packages/auth/src/contracts.spec.ts packages/db/src/user.repository.ts packages/db/src/user.repository.spec.ts
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
