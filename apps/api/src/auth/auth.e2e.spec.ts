import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { nextThrottleState, type PublicUser, type ThrottleState } from "@yt-monitor/auth";
import type { ApiEnv } from "@yt-monitor/config";
import type {
  AppendAuditLogInput,
  IdentityRepositories,
  WorkerHeartbeatRecord,
} from "@yt-monitor/db";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../app.module.js";
import type { DatabaseHealthReader, WorkerHeartbeatReader } from "../health/health.service.js";
import { AuthApplicationError } from "./auth-application.error.js";
import type { AuthApplicationPort } from "./auth-application.port.js";
import { AuthService, DUMMY_PASSWORD_HASH } from "./auth.service.js";
import { LoginThrottleService } from "./login-throttle.service.js";
import type {
  AuthenticatedPrincipal,
  SessionAuthenticationPort,
} from "./session-authentication.port.js";

const ALLOWED_ORIGIN = "http://127.0.0.1:3000";
const SESSION_TOKEN = "n".repeat(43);
const OLD_FIXATION_TOKEN = "f".repeat(43);
const USER: PublicUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "viewer@example.com",
  role: "VIEWER",
  isEnabled: true,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  disabledAt: null,
};

const ENV: ApiEnv = {
  NODE_ENV: "test",
  APP_VERSION: "0.1.0",
  APP_TIMEZONE: "Asia/Bangkok",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://unused:unused@invalid.test/unused",
  API_PORT: 5000,
  WORKER_HEARTBEAT_STALE_SECONDS: 45,
  DEPLOYMENT_MODE: "LOCAL",
  APP_PUBLIC_URL: ALLOWED_ORIGIN,
  APP_ALLOWED_ORIGINS: [ALLOWED_ORIGIN],
  SESSION_SECRET: "s".repeat(32),
  SESSION_IDLE_MINUTES: 120,
  SESSION_ABSOLUTE_HOURS: 24,
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_LOCK_MINUTES: 15,
  TRUST_PROXY: false,
};

class AvailableDatabase implements DatabaseHealthReader {
  async pingDatabase(): Promise<{ latencyMs: number }> {
    return { latencyMs: 1 };
  }
}

class AvailableWorker implements WorkerHeartbeatReader {
  async getFreshestRunningHeartbeat(): Promise<WorkerHeartbeatRecord> {
    return {
      workerId: "worker-a",
      version: "0.1.0",
      status: "RUNNING",
      lastSeenAt: new Date("2026-08-21T00:00:00.000Z"),
    };
  }
}

class StatefulAuth implements AuthApplicationPort, SessionAuthenticationPort {
  readonly logins: Array<{ email: string; password: string }> = [];
  readonly logouts: Array<{ userId: string; sessionId: string }> = [];
  readonly passwordChanges: Array<{
    userId: string;
    currentPassword: string;
    newPassword: string;
  }> = [];
  private readonly principals = new Map<string, AuthenticatedPrincipal>();
  loginError: Error | undefined;
  logoutError: Error | undefined;
  passwordError: Error | undefined;

  async login(input: { email: string; password: string }) {
    if (this.loginError) throw this.loginError;
    this.logins.push(input);
    this.principals.set(SESSION_TOKEN, { user: USER, session: { id: "session-id" } });
    return { user: USER, sessionToken: SESSION_TOKEN };
  }

  async logout(input: { userId: string; sessionId: string }): Promise<void> {
    if (this.logoutError) throw this.logoutError;
    this.logouts.push(input);
    this.principals.delete(SESSION_TOKEN);
  }

  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    if (this.passwordError) throw this.passwordError;
    this.passwordChanges.push(input);
    this.principals.delete(SESSION_TOKEN);
  }

  async authenticate(token: string): Promise<AuthenticatedPrincipal | null> {
    return this.principals.get(token) ?? null;
  }
}

const VALID_CSRF_HEADERS = {
  Origin: ALLOWED_ORIGIN,
  "X-CSRF-Protection": "1",
};

async function createApp(
  auth?: StatefulAuth,
  authApplication?: AuthApplicationPort,
): Promise<INestApplication> {
  const application = authApplication ?? auth;
  const dynamicModule = AppModule.forTesting({
    env: ENV,
    databaseHealthReader: new AvailableDatabase(),
    workerHeartbeatReader: new AvailableWorker(),
    ...(application ? { authApplication: application } : {}),
    ...(auth ? { sessionAuthenticator: auth } : {}),
  });
  const module = await Test.createTestingModule({ imports: [dynamicModule] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.init();
  return app;
}

function createUnsafeIdentifierService() {
  const audits: AppendAuditLogInput[] = [];
  const throttleRows = new Map<string, ThrottleState>();
  const findByCanonicalEmail = vi.fn(async () => {
    throw new Error("database lookup must not receive an unsafe identifier");
  });
  const passwords = {
    verify: vi.fn(async () => ({ valid: false, needsRehash: false })),
    hash: vi.fn(async () => "unused"),
    rehash: vi.fn(async () => "unused"),
  };
  const repositories = {
    throttles: {
      async getLocked(_scope: "IDENTIFIER", keyHash: Uint8Array) {
        return throttleRows.get(Buffer.from(keyHash).toString("base64url")) ?? null;
      },
      async registerFailure(
        _scope: "IDENTIFIER",
        keyHash: Uint8Array,
        now: Date,
        policy: { maxAttempts: number; windowMinutes: number; lockMinutes: number },
      ) {
        const key = Buffer.from(keyHash).toString("base64url");
        const next = nextThrottleState(throttleRows.get(key) ?? null, now, policy);
        throttleRows.set(key, next);
        return next;
      },
      async clear() {},
    },
    audit: {
      async append(input: AppendAuditLogInput) {
        audits.push(structuredClone(input));
        return { id: "audit-id", ...input, createdAt: new Date("2026-08-22T01:00:00.000Z") };
      },
    },
  } as unknown as IdentityRepositories;
  const throttle = new LoginThrottleService({
    sessionSecret: "s".repeat(32),
    maxAttempts: 5,
    lockMinutes: 15,
  });
  const service = new AuthService({
    users: {
      findByCanonicalEmail,
      findById: vi.fn(async () => null),
    },
    unitOfWork: { transaction: async (work) => work(repositories) },
    throttle,
    clock: { now: () => new Date("2026-08-22T01:00:00.000Z") },
    entropy: { bytes: (length) => new Uint8Array(length) },
    passwords,
    sessionSecret: "s".repeat(32),
    sessionIdleMinutes: 120,
    sessionAbsoluteHours: 24,
  });

  return { service, audits, throttleRows, findByCanonicalEmail, passwords };
}

function expectExactError(
  response: request.Response,
  status: number,
  code: string,
  message: string,
): void {
  expect(response.status).toBe(status);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body).toEqual({ error: { code, message } });
}

describe("auth HTTP contract", () => {
  const apps: INestApplication[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("logs in with a fresh active-mode cookie, exposes /me, then revokes and clears on logout", async () => {
    const auth = new StatefulAuth();
    const app = await createApp(auth);
    apps.push(app);
    const agent = request.agent(app.getHttpServer());

    const login = await agent
      .post("/api/v1/auth/login")
      .set(VALID_CSRF_HEADERS)
      .set("Cookie", `yhm_session=${OLD_FIXATION_TOKEN}`)
      .set("X-Forwarded-For", "203.0.113.77")
      .send({ email: "NOT-AN-EMAIL", password: "" })
      .expect(200);

    expect(login.headers["cache-control"]).toBe("no-store");
    expect(login.body).toEqual({ user: USER });
    expect(login.headers["set-cookie"]).toEqual([
      `yhm_session=${SESSION_TOKEN}; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax`,
    ]);
    expect(login.headers["set-cookie"]?.[0]).not.toContain(OLD_FIXATION_TOKEN);
    expect(auth.logins).toEqual([{ email: "NOT-AN-EMAIL", password: "" }]);

    const me = await agent.get("/api/v1/auth/me").expect(200);
    expect(me.headers["cache-control"]).toBe("no-store");
    expect(me.body).toEqual({ user: USER });

    const logout = await agent
      .post("/api/v1/auth/logout")
      .set(VALID_CSRF_HEADERS)
      .set("Content-Type", "application/json")
      .expect(204);
    expect(logout.text).toBe("");
    expect(logout.headers["cache-control"]).toBe("no-store");
    expect(logout.headers["set-cookie"]).toEqual([
      "yhm_session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
    ]);
    expect(auth.logouts).toEqual([{ userId: USER.id, sessionId: "session-id" }]);

    await agent.get("/api/v1/auth/me").expect(401);
  });

  it("accepts exact empty logout body and rejects every other syntactically valid shape", async () => {
    const auth = new StatefulAuth();
    const app = await createApp(auth);
    apps.push(app);

    async function loginAgent() {
      const agent = request.agent(app.getHttpServer());
      await agent
        .post("/api/v1/auth/login")
        .set(VALID_CSRF_HEADERS)
        .send({ email: USER.email, password: "password" })
        .expect(200);
      return agent;
    }

    await (
      await loginAgent()
    )
      .post("/api/v1/auth/logout")
      .set(VALID_CSRF_HEADERS)
      .send({})
      .expect(204);

    for (const invalidBody of [{ reason: "done" }, [], "text", null]) {
      const response = await (
        await loginAgent()
      )
        .post("/api/v1/auth/logout")
        .set(VALID_CSRF_HEADERS)
        .set("Content-Type", "application/json")
        .send(invalidBody as never);
      expectExactError(response, 400, "VALIDATION_ERROR", "Invalid request");
    }
  });

  it("maps structural, new-password-policy, and malformed JSON failures to the exact 400", async () => {
    const auth = new StatefulAuth();
    const app = await createApp(auth);
    apps.push(app);

    for (const invalidBody of [
      {},
      { email: USER.email, password: "password", extra: true },
      { email: USER.email, password: 1 },
    ]) {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .set(VALID_CSRF_HEADERS)
        .send(invalidBody);
      expectExactError(response, 400, "VALIDATION_ERROR", "Invalid request");
    }

    const malformed = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set(VALID_CSRF_HEADERS)
      .set("Content-Type", "application/json")
      .send('{"email":');
    expectExactError(malformed, 400, "VALIDATION_ERROR", "Invalid request");

    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .set(VALID_CSRF_HEADERS)
      .send({ email: USER.email, password: "password" })
      .expect(200);
    const passwordPolicy = await agent
      .post("/api/v1/auth/change-password")
      .set(VALID_CSRF_HEADERS)
      .send({ currentPassword: "", newPassword: "short" });
    expectExactError(passwordPolicy, 400, "VALIDATION_ERROR", "Invalid request");
  });

  it("routes a JSON NUL identifier through dummy verification to exact 401 without a DB lookup", async () => {
    const harness = createUnsafeIdentifierService();
    const app = await createApp(undefined, harness.service);
    apps.push(app);

    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set(VALID_CSRF_HEADERS)
      .send({
        email: "http-db-unsafe\u0000sentinel@example.com",
        password: "http-planted-password",
      });

    expectExactError(response, 401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
    expect(harness.findByCanonicalEmail).not.toHaveBeenCalled();
    expect(harness.passwords.verify).toHaveBeenCalledExactlyOnceWith(
      DUMMY_PASSWORD_HASH,
      "http-planted-password",
    );
    expect(harness.audits).toHaveLength(1);
    expect(harness.audits[0]?.metadata).toEqual({ reason: "UNKNOWN_IDENTIFIER" });
    expect(harness.throttleRows.size).toBe(1);
    expect(JSON.stringify({ audits: harness.audits, throttle: harness.throttleRows })).not.toMatch(
      /http-db-unsafe|http-planted-password/u,
    );
  });

  it("preserves session-before-CSRF precedence while Public login still reaches CSRF first", async () => {
    const auth = new StatefulAuth();
    const app = await createApp(auth);
    apps.push(app);

    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: USER.email, password: "password" });
    expectExactError(login, 403, "AUTH_CSRF_INVALID", "Invalid CSRF request");
    expect(auth.logins).toHaveLength(0);

    const anonymousLogout = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Origin", "https://hostile.example.test")
      .send({});
    expectExactError(anonymousLogout, 401, "AUTH_UNAUTHENTICATED", "Authentication required");

    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .set(VALID_CSRF_HEADERS)
      .send({ email: USER.email, password: "password" })
      .expect(200);
    const authenticatedBadCsrf = await agent
      .post("/api/v1/auth/change-password")
      .set("Origin", "https://hostile.example.test")
      .send({ currentPassword: "password", newPassword: "new password valid" });
    expectExactError(authenticatedBadCsrf, 403, "AUTH_CSRF_INVALID", "Invalid CSRF request");
    expect(auth.passwordChanges).toHaveLength(0);
  });

  it("returns exact committed application errors and Retry-After", async () => {
    const auth = new StatefulAuth();
    const app = await createApp(auth);
    apps.push(app);

    auth.loginError = AuthApplicationError.invalidLogin();
    const invalid = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set(VALID_CSRF_HEADERS)
      .send({ email: USER.email, password: "wrong" });
    expectExactError(invalid, 401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");

    auth.loginError = AuthApplicationError.rateLimited(
      new Date("2026-08-22T01:00:01.001Z"),
      new Date("2026-08-22T01:00:00.000Z"),
    );
    const limited = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set(VALID_CSRF_HEADERS)
      .send({ email: USER.email, password: "wrong" });
    expectExactError(limited, 429, "AUTH_RATE_LIMITED", "Too many login attempts");
    expect(limited.headers["retry-after"]).toBe("2");
  });

  it("clears the cookie only after committed logout/password change and never after database failure", async () => {
    const auth = new StatefulAuth();
    const app = await createApp(auth);
    apps.push(app);
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .set(VALID_CSRF_HEADERS)
      .send({ email: USER.email, password: "password" })
      .expect(200);

    auth.logoutError = new Error("database failed");
    const failedLogout = await agent
      .post("/api/v1/auth/logout")
      .set(VALID_CSRF_HEADERS)
      .send({})
      .expect(500);
    expect(failedLogout.headers["set-cookie"]).toBeUndefined();
    auth.logoutError = undefined;

    auth.passwordError = AuthApplicationError.invalidCurrentPassword();
    const wrong = await agent
      .post("/api/v1/auth/change-password")
      .set(VALID_CSRF_HEADERS)
      .send({ currentPassword: "wrong", newPassword: "new password valid" });
    expectExactError(wrong, 401, "AUTH_INVALID_CREDENTIALS", "Current password is incorrect");
    expect(wrong.headers["set-cookie"]).toBeUndefined();

    auth.passwordError = new Error("database failed");
    const failed = await agent
      .post("/api/v1/auth/change-password")
      .set(VALID_CSRF_HEADERS)
      .send({ currentPassword: "password", newPassword: "new password valid" })
      .expect(500);
    expect(failed.headers["set-cookie"]).toBeUndefined();

    auth.passwordError = undefined;
    const changed = await agent
      .post("/api/v1/auth/change-password")
      .set(VALID_CSRF_HEADERS)
      .send({ currentPassword: "", newPassword: "new password valid" })
      .expect(204);
    expect(changed.text).toBe("");
    expect(changed.headers["cache-control"]).toBe("no-store");
    expect(changed.headers["set-cookie"]?.[0]).toContain("Max-Age=0");
    expect(auth.passwordChanges.at(-1)).toEqual({
      userId: USER.id,
      currentPassword: "",
      newPassword: "new password valid",
    });
  });

  it("fails closed when authApplication is omitted", async () => {
    const app = await createApp();
    apps.push(app);

    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set(VALID_CSRF_HEADERS)
      .send({ email: USER.email, password: "password" })
      .expect(401);
    expect(response.headers["set-cookie"]).toBeUndefined();
    await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Cookie", `yhm_session=${SESSION_TOKEN}`)
      .expect(401);
  });
});
