import { Controller, Get, Post, Req, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import type { PublicUser } from "@yt-monitor/auth";
import type { ApiEnv } from "@yt-monitor/config";
import type { WorkerHeartbeatRecord } from "@yt-monitor/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import type { DatabaseHealthReader, WorkerHeartbeatReader } from "../health/health.service.js";
import { AuthExceptionFilter } from "./auth-exception.filter.js";
import { Public } from "./public.decorator.js";
import { Roles } from "./roles.decorator.js";
import { RolesGuard } from "./roles.guard.js";
import type {
  AuthenticatedPrincipal,
  SessionAuthenticationPort,
} from "./session-authentication.port.js";
import type { AuthenticatedRequest } from "./request-user.js";

const ALLOWED_ORIGIN = "http://127.0.0.1:3000";
const ADMIN_TOKEN = "a".repeat(43);
const VIEWER_TOKEN = "v".repeat(43);

const ADMIN_USER: PublicUser = {
  id: "admin-id",
  email: "admin@example.test",
  role: "ADMIN",
  isEnabled: true,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  disabledAt: null,
};

const VIEWER_USER: PublicUser = {
  ...ADMIN_USER,
  id: "viewer-id",
  email: "viewer@example.test",
  role: "VIEWER",
};

const LOCAL_ENV: ApiEnv = {
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

const PUBLIC_ENV: ApiEnv = {
  ...LOCAL_ENV,
  DEPLOYMENT_MODE: "PUBLIC",
  APP_PUBLIC_URL: "https://monitor.example.test",
  APP_ALLOWED_ORIGINS: ["https://monitor.example.test"],
  TRUST_PROXY: true,
};

const UNAUTHENTICATED_BODY = {
  error: { code: "AUTH_UNAUTHENTICATED", message: "Authentication required" },
};

const FORBIDDEN_BODY = {
  error: { code: "AUTH_FORBIDDEN", message: "Forbidden" },
};

const CSRF_BODY = {
  error: { code: "AUTH_CSRF_INVALID", message: "Invalid CSRF request" },
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

class FixedSessionAuthenticator implements SessionAuthenticationPort {
  constructor(private readonly principals: ReadonlyMap<string, AuthenticatedPrincipal>) {}

  async authenticate(token: string): Promise<AuthenticatedPrincipal | null> {
    return this.principals.get(token) ?? null;
  }
}

class ThrowingSessionAuthenticator implements SessionAuthenticationPort {
  async authenticate(): Promise<never> {
    throw new Error("postgresql://private-user:private-password@database/private");
  }
}

@Controller("test-policy")
@Roles("ADMIN")
class SecurityPolicyProbeController {
  @Get("protected")
  protected(@Req() authenticatedRequest: AuthenticatedRequest) {
    return {
      user: authenticatedRequest.user,
      session: authenticatedRequest.session,
    };
  }

  @Post("unsafe-admin")
  unsafeAdmin() {
    return { ok: true };
  }

  @Get("viewer-override")
  @Roles("VIEWER")
  viewerOverride() {
    return { ok: true };
  }

  @Post("public-unsafe")
  @Public()
  @Roles("ADMIN")
  publicUnsafe() {
    return { ok: true };
  }
}

@Controller("test-missing-principal")
@Roles("ADMIN")
class MissingPrincipalProbeController {
  @Get()
  get() {
    return { ok: true };
  }
}

function principal(user: PublicUser, sessionId: string): AuthenticatedPrincipal {
  return { user, session: { id: sessionId } };
}

function validAuthenticator(): SessionAuthenticationPort {
  const adminPrincipal = {
    user: { ...ADMIN_USER, passwordHash: "planted-password-hash" },
    session: { id: "admin-session-id", tokenHash: "planted-token-hash" },
    rawToken: "planted-raw-token",
  } as unknown as AuthenticatedPrincipal;

  return new FixedSessionAuthenticator(
    new Map([
      [ADMIN_TOKEN, adminPrincipal],
      [VIEWER_TOKEN, principal(VIEWER_USER, "viewer-session-id")],
    ]),
  );
}

async function createPolicyApp(
  env: ApiEnv,
  sessionAuthenticator?: SessionAuthenticationPort,
): Promise<INestApplication> {
  const dynamicModule = AppModule.forTesting({
    env,
    databaseHealthReader: new AvailableDatabase(),
    workerHeartbeatReader: new AvailableWorker(),
    ...(sessionAuthenticator ? { sessionAuthenticator } : {}),
  });
  const module = await Test.createTestingModule({
    imports: [dynamicModule],
    controllers: [SecurityPolicyProbeController],
  }).compile();

  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.init();
  return app;
}

async function createRolesOnlyApp(): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    controllers: [MissingPrincipalProbeController],
    providers: [
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_FILTER, useClass: AuthExceptionFilter },
    ],
  }).compile();

  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.init();
  return app;
}

function expectExactPolicyResponse(
  response: request.Response,
  status: 401 | 403,
  body: typeof UNAUTHENTICATED_BODY | typeof FORBIDDEN_BODY | typeof CSRF_BODY,
): void {
  expect(response.status).toBe(status);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body).toEqual(body);
}

describe("default-deny API security pipeline", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createPolicyApp(LOCAL_ENV, validAuthenticator());
  });

  afterAll(async () => {
    await app.close();
  });

  it("denies a route without Public metadata when no session cookie exists", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/test-policy/protected");

    expectExactPolicyResponse(response, 401, UNAUTHENTICATED_BODY);
  });

  it("fails closed when the authenticator is omitted despite a valid-looking active cookie", async () => {
    const denyAllApp = await createPolicyApp(LOCAL_ENV);

    try {
      const response = await request(denyAllApp.getHttpServer())
        .get("/api/v1/test-policy/protected")
        .set("Cookie", `yhm_session=${ADMIN_TOKEN}`);

      expectExactPolicyResponse(response, 401, UNAUTHENTICATED_BODY);
    } finally {
      await denyAllApp.close();
    }
  });

  it.each([
    ["invalid", "i".repeat(43)],
    ["expired", "e".repeat(43)],
    ["revoked", "r".repeat(43)],
    ["disabled-user", "d".repeat(43)],
  ])("returns the identical secret-free 401 for a fake %s session", async (_state, token) => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/test-policy/protected")
      .set("Cookie", `yhm_session=${token}`);

    expectExactPolicyResponse(response, 401, UNAUTHENTICATED_BODY);
    expect(JSON.stringify(response.body)).not.toMatch(
      /cookie|token|database|invalid|expired|revoked|disabled/i,
    );
  });

  it.each([
    ["empty active cookie", "yhm_session="],
    ["malformed active cookie", "yhm_session=%E0%A4%A"],
    ["wrong-mode cookie", `__Host-yhm_session=${ADMIN_TOKEN}`],
  ])("returns the same unauthenticated response for an %s", async (_case, cookie) => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/test-policy/protected")
      .set("Cookie", cookie);

    expectExactPolicyResponse(response, 401, UNAUTHENTICATED_BODY);
  });

  it("accepts only the public cookie name in PUBLIC deployment mode", async () => {
    const publicApp = await createPolicyApp(PUBLIC_ENV, validAuthenticator());

    try {
      const wrongMode = await request(publicApp.getHttpServer())
        .get("/api/v1/test-policy/protected")
        .set("Cookie", `yhm_session=${ADMIN_TOKEN}`);
      expectExactPolicyResponse(wrongMode, 401, UNAUTHENTICATED_BODY);

      await request(publicApp.getHttpServer())
        .get("/api/v1/test-policy/protected")
        .set("Cookie", `__Host-yhm_session=${ADMIN_TOKEN}`)
        .expect(200);
    } finally {
      await publicApp.close();
    }
  });

  it("attaches only the safe user and session ID to an authenticated request", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/test-policy/protected")
      .set("Cookie", `yhm_session=${ADMIN_TOKEN}`)
      .expect(200);

    expect(response.body).toEqual({
      user: ADMIN_USER,
      session: { id: "admin-session-id" },
    });
  });

  it("evaluates session before role and CSRF policies", async () => {
    const anonymous = await request(app.getHttpServer())
      .post("/api/v1/test-policy/unsafe-admin")
      .set("Origin", "https://hostile.example.test")
      .send({});
    expectExactPolicyResponse(anonymous, 401, UNAUTHENTICATED_BODY);

    const viewer = await request(app.getHttpServer())
      .post("/api/v1/test-policy/unsafe-admin")
      .set("Cookie", `yhm_session=${VIEWER_TOKEN}`)
      .set("Origin", "https://hostile.example.test")
      .send({});
    expectExactPolicyResponse(viewer, 403, FORBIDDEN_BODY);

    const admin = await request(app.getHttpServer())
      .post("/api/v1/test-policy/unsafe-admin")
      .set("Cookie", `yhm_session=${ADMIN_TOKEN}`)
      .set("Origin", "https://hostile.example.test")
      .send({});
    expectExactPolicyResponse(admin, 403, CSRF_BODY);
  });

  it("lets handler role metadata override controller role metadata", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/test-policy/viewer-override")
      .set("Cookie", `yhm_session=${VIEWER_TOKEN}`)
      .expect(200);

    const admin = await request(app.getHttpServer())
      .get("/api/v1/test-policy/viewer-override")
      .set("Cookie", `yhm_session=${ADMIN_TOKEN}`);
    expectExactPolicyResponse(admin, 403, FORBIDDEN_BODY);
  });

  it("returns the exact unauthenticated policy response when role metadata has no principal", async () => {
    const rolesOnlyApp = await createRolesOnlyApp();

    try {
      const response = await request(rolesOnlyApp.getHttpServer()).get(
        "/api/v1/test-missing-principal",
      );

      expectExactPolicyResponse(response, 401, UNAUTHENTICATED_BODY);
    } finally {
      await rolesOnlyApp.close();
    }
  });

  it("lets Public metadata override roles while still enforcing CSRF", async () => {
    const invalidCsrf = await request(app.getHttpServer())
      .post("/api/v1/test-policy/public-unsafe")
      .send({});
    expectExactPolicyResponse(invalidCsrf, 403, CSRF_BODY);

    await request(app.getHttpServer())
      .post("/api/v1/test-policy/public-unsafe")
      .set("Origin", ALLOWED_ORIGIN)
      .set("X-CSRF-Protection", "1")
      .send({})
      .expect(201, { ok: true });
  });

  it("does not translate authenticator infrastructure exceptions into auth policy errors", async () => {
    const unavailableApp = await createPolicyApp(LOCAL_ENV, new ThrowingSessionAuthenticator());

    try {
      const response = await request(unavailableApp.getHttpServer())
        .get("/api/v1/test-policy/protected")
        .set("Cookie", `yhm_session=${ADMIN_TOKEN}`)
        .expect(500);

      expect(response.body).not.toEqual(UNAUTHENTICATED_BODY);
      expect(JSON.stringify(response.body)).not.toContain("private-password");
    } finally {
      await unavailableApp.close();
    }
  });
});
