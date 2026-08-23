import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PublicUser } from "@yt-monitor/auth";
import type { ApiEnv } from "@yt-monitor/config";
import type { WorkerHeartbeatRecord } from "@yt-monitor/db";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import type {
  AuthenticatedPrincipal,
  SessionAuthenticationPort,
} from "../auth/session-authentication.port.js";
import type { DatabaseHealthReader, WorkerHeartbeatReader } from "../health/health.service.js";
import { UserApplicationError } from "./user-application.error.js";
import type { UsersApplicationPort } from "./users-application.port.js";

const ORIGIN = "http://127.0.0.1:3000";
const ADMIN_TOKEN = "a".repeat(43);
const VIEWER_TOKEN = "v".repeat(43);
const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const VIEWER_ID = "00000000-0000-4000-8000-000000000002";

const ADMIN: PublicUser = {
  id: ADMIN_ID,
  email: "admin@example.com",
  role: "ADMIN",
  isEnabled: true,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  disabledAt: null,
};

const VIEWER: PublicUser = {
  id: VIEWER_ID,
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
  DATABASE_URL: "postgresql://must:not-be-used@invalid.test/unused",
  API_PORT: 5000,
  WORKER_HEARTBEAT_STALE_SECONDS: 45,
  DEPLOYMENT_MODE: "LOCAL",
  APP_PUBLIC_URL: ORIGIN,
  APP_ALLOWED_ORIGINS: [ORIGIN],
  SESSION_SECRET: "s".repeat(32),
  SESSION_IDLE_MINUTES: 120,
  SESSION_ABSOLUTE_HOURS: 24,
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_LOCK_MINUTES: 15,
  TRUST_PROXY: false,
};

const ADMIN_COOKIE = `yhm_session=${ADMIN_TOKEN}`;
const VIEWER_COOKIE = `yhm_session=${VIEWER_TOKEN}`;
const VALID_CSRF = { Origin: ORIGIN, "X-CSRF-Protection": "1" };

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
      lastSeenAt: new Date("2026-08-22T00:00:00.000Z"),
    };
  }
}

class FixedSessions implements SessionAuthenticationPort {
  async authenticate(token: string): Promise<AuthenticatedPrincipal | null> {
    if (token === ADMIN_TOKEN) return { user: ADMIN, session: { id: "admin-session" } };
    if (token === VIEWER_TOKEN) return { user: VIEWER, session: { id: "viewer-session" } };
    return null;
  }
}

type UserCall = { method: string; input: unknown };

class StatefulUsers implements UsersApplicationPort {
  readonly calls: UserCall[] = [];
  error: Error | undefined;

  private failOrRecord(method: string, input: unknown): void {
    if (this.error) throw this.error;
    this.calls.push({ method, input: structuredClone(input) });
  }

  async list(input: { page: number; pageSize: number }) {
    this.failOrRecord("list", input);
    return { items: [VIEWER], page: input.page, pageSize: input.pageSize, total: 1 };
  }

  async create(input: { actorUserId: string; email: string; password: string }) {
    this.failOrRecord("create", input);
    return VIEWER;
  }

  async updateEmail(input: { actorUserId: string; targetUserId: string; email: string }) {
    this.failOrRecord("updateEmail", input);
    return { ...VIEWER, email: input.email };
  }

  async resetPassword(input: {
    actorUserId: string;
    targetUserId: string;
    password: string;
  }): Promise<void> {
    this.failOrRecord("resetPassword", input);
  }

  async revokeSessions(input: { actorUserId: string; targetUserId: string }): Promise<void> {
    this.failOrRecord("revokeSessions", input);
  }

  async disable(input: {
    actorUserId: string;
    targetUserId: string;
    via: "DISABLE_ENDPOINT" | "DELETE_ALIAS";
  }): Promise<void> {
    this.failOrRecord("disable", input);
  }

  async enable(input: { actorUserId: string; targetUserId: string }): Promise<void> {
    this.failOrRecord("enable", input);
  }
}

async function createApp(options: {
  users?: UsersApplicationPort;
  sessions?: SessionAuthenticationPort;
}): Promise<INestApplication> {
  const dynamicModule = AppModule.forTesting({
    env: ENV,
    databaseHealthReader: new AvailableDatabase(),
    workerHeartbeatReader: new AvailableWorker(),
    ...(options.sessions ? { sessionAuthenticator: options.sessions } : {}),
    ...(options.users ? { usersApplication: options.users } : {}),
  });
  const module = await Test.createTestingModule({ imports: [dynamicModule] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.init();
  return app;
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

function expectNoStore(response: request.Response): void {
  expect(response.headers["cache-control"]).toBe("no-store");
}

describe("ADMIN VIEWER-management HTTP contract", () => {
  const apps: INestApplication[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("implements the eight exact routes with actor propagation, strict outputs, and no-store", async () => {
    const users = new StatefulUsers();
    const app = await createApp({ users, sessions: new FixedSessions() });
    apps.push(app);
    const server = app.getHttpServer();

    const list = await request(server)
      .get("/api/v1/users?page=2&pageSize=25")
      .set("Cookie", ADMIN_COOKIE)
      .expect(200);
    expectNoStore(list);
    expect(list.body).toEqual({ items: [VIEWER], page: 2, pageSize: 25, total: 1 });
    expect(JSON.stringify(list.body)).not.toMatch(/password|hash|session/i);

    const create = await request(server)
      .post("/api/v1/users")
      .set("Cookie", ADMIN_COOKIE)
      .set(VALID_CSRF)
      .send({ email: " NEW@Example.COM ", password: "planted password!" })
      .expect(201);
    expectNoStore(create);
    expect(create.body).toEqual({ user: VIEWER });

    const update = await request(server)
      .patch(`/api/v1/users/${VIEWER_ID}`)
      .set("Cookie", ADMIN_COOKIE)
      .set(VALID_CSRF)
      .send({ email: " NEXT@Example.COM " })
      .expect(200);
    expectNoStore(update);
    expect(update.body).toEqual({ user: { ...VIEWER, email: "next@example.com" } });

    const actions = [
      () =>
        request(server)
          .post(`/api/v1/users/${VIEWER_ID}/reset-password`)
          .set("Cookie", ADMIN_COOKIE)
          .set(VALID_CSRF)
          .send({ password: "replacement password" }),
      () =>
        request(server)
          .post(`/api/v1/users/${VIEWER_ID}/revoke-sessions`)
          .set("Cookie", ADMIN_COOKIE)
          .set(VALID_CSRF)
          .set("Content-Type", "application/json"),
      () =>
        request(server)
          .post(`/api/v1/users/${VIEWER_ID}/disable`)
          .set("Cookie", ADMIN_COOKIE)
          .set(VALID_CSRF)
          .send({}),
      () =>
        request(server)
          .post(`/api/v1/users/${VIEWER_ID}/enable`)
          .set("Cookie", ADMIN_COOKIE)
          .set(VALID_CSRF)
          .send({}),
      () =>
        request(server)
          .delete(`/api/v1/users/${VIEWER_ID}`)
          .set("Cookie", ADMIN_COOKIE)
          .set(VALID_CSRF)
          .send({}),
    ];
    for (const action of actions) {
      const response = await action().expect(204);
      expectNoStore(response);
      expect(response.text).toBe("");
    }

    expect(users.calls).toEqual([
      { method: "list", input: { page: 2, pageSize: 25 } },
      {
        method: "create",
        input: { actorUserId: ADMIN_ID, email: "new@example.com", password: "planted password!" },
      },
      {
        method: "updateEmail",
        input: { actorUserId: ADMIN_ID, targetUserId: VIEWER_ID, email: "next@example.com" },
      },
      {
        method: "resetPassword",
        input: {
          actorUserId: ADMIN_ID,
          targetUserId: VIEWER_ID,
          password: "replacement password",
        },
      },
      {
        method: "revokeSessions",
        input: { actorUserId: ADMIN_ID, targetUserId: VIEWER_ID },
      },
      {
        method: "disable",
        input: { actorUserId: ADMIN_ID, targetUserId: VIEWER_ID, via: "DISABLE_ENDPOINT" },
      },
      { method: "enable", input: { actorUserId: ADMIN_ID, targetUserId: VIEWER_ID } },
      {
        method: "disable",
        input: { actorUserId: ADMIN_ID, targetUserId: VIEWER_ID, via: "DELETE_ALIAS" },
      },
    ]);
  });

  it("enforces session, ADMIN role, CSRF, then validation precedence", async () => {
    const users = new StatefulUsers();
    const app = await createApp({ users, sessions: new FixedSessions() });
    apps.push(app);
    const path = "/api/v1/users";

    const anonymous = await request(app.getHttpServer())
      .post(path)
      .set("Origin", "https://hostile.example.test")
      .send({ email: "bad", password: "short" });
    expectExactError(anonymous, 401, "AUTH_UNAUTHENTICATED", "Authentication required");

    const viewer = await request(app.getHttpServer())
      .post(path)
      .set("Cookie", VIEWER_COOKIE)
      .set("Origin", "https://hostile.example.test")
      .send({ email: "bad", password: "short" });
    expectExactError(viewer, 403, "AUTH_FORBIDDEN", "Forbidden");

    const csrf = await request(app.getHttpServer())
      .post(path)
      .set("Cookie", ADMIN_COOKIE)
      .set("Origin", "https://hostile.example.test")
      .send({ email: "bad", password: "short" });
    expectExactError(csrf, 403, "AUTH_CSRF_INVALID", "Invalid CSRF request");

    const validation = await request(app.getHttpServer())
      .post(path)
      .set("Cookie", ADMIN_COOKIE)
      .set(VALID_CSRF)
      .send({ email: "bad", password: "short" });
    expectExactError(validation, 400, "VALIDATION_ERROR", "Invalid request");
    expect(users.calls).toEqual([]);
  });

  it("rejects unknown/repeated/non-canonical pagination before invoking the port", async () => {
    const users = new StatefulUsers();
    const app = await createApp({ users, sessions: new FixedSessions() });
    apps.push(app);

    for (const query of [
      "?page=1&page=2",
      "?pageSize=20&pageSize=30",
      "?page=01",
      "?page=1e2",
      "?pageSize=101",
      "?search=viewer",
      "?page=9007199254740991&pageSize=2",
    ]) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/users${query}`)
        .set("Cookie", ADMIN_COOKIE);
      expectExactError(response, 400, "VALIDATION_ERROR", "Invalid request");
    }
    expect(users.calls).toEqual([]);
  });

  it("rejects role/unknown/primitive bodies, invalid UUIDs, and non-empty action bodies", async () => {
    const users = new StatefulUsers();
    const app = await createApp({ users, sessions: new FixedSessions() });
    apps.push(app);
    const server = app.getHttpServer();

    for (const body of [
      { email: "viewer@example.com", password: "replacement password", role: "ADMIN" },
      { email: "viewer@example.com", password: "replacement password", extra: true },
      [],
      "text",
      null,
    ]) {
      const response = await request(server)
        .post("/api/v1/users")
        .set("Cookie", ADMIN_COOKIE)
        .set(VALID_CSRF)
        .set("Content-Type", "application/json")
        .send(body as never);
      expectExactError(response, 400, "VALIDATION_ERROR", "Invalid request");
    }

    const invalidId = await request(server)
      .post("/api/v1/users/not-a-uuid/disable")
      .set("Cookie", ADMIN_COOKIE)
      .set(VALID_CSRF)
      .send({});
    expectExactError(invalidId, 400, "VALIDATION_ERROR", "Invalid request");

    for (const suffix of ["revoke-sessions", "disable", "enable"]) {
      const response = await request(server)
        .post(`/api/v1/users/${VIEWER_ID}/${suffix}`)
        .set("Cookie", ADMIN_COOKIE)
        .set(VALID_CSRF)
        .send({ reason: "admin" });
      expectExactError(response, 400, "VALIDATION_ERROR", "Invalid request");
    }
    const deleteResponse = await request(server)
      .delete(`/api/v1/users/${VIEWER_ID}`)
      .set("Cookie", ADMIN_COOKIE)
      .set(VALID_CSRF)
      .send({ reason: "admin" });
    expectExactError(deleteResponse, 400, "VALIDATION_ERROR", "Invalid request");
    expect(users.calls).toEqual([]);
  });

  it("maps known user errors exactly and applies no-store", async () => {
    const users = new StatefulUsers();
    const app = await createApp({ users, sessions: new FixedSessions() });
    apps.push(app);

    users.error = UserApplicationError.notFound();
    const missing = await request(app.getHttpServer())
      .post(`/api/v1/users/${VIEWER_ID}/revoke-sessions`)
      .set("Cookie", ADMIN_COOKIE)
      .set(VALID_CSRF)
      .send({});
    expectExactError(missing, 404, "USER_NOT_FOUND", "User not found");

    users.error = UserApplicationError.alreadyExists();
    const conflict = await request(app.getHttpServer())
      .patch(`/api/v1/users/${VIEWER_ID}`)
      .set("Cookie", ADMIN_COOKIE)
      .set(VALID_CSRF)
      .send({ email: "duplicate@example.com" });
    expectExactError(conflict, 409, "USER_ALREADY_EXISTS", "A user with that email already exists");

    users.error = UserApplicationError.forbidden();
    const protectedTarget = await request(app.getHttpServer())
      .post(`/api/v1/users/${ADMIN_ID}/disable`)
      .set("Cookie", ADMIN_COOKIE)
      .set(VALID_CSRF)
      .send({});
    expectExactError(protectedTarget, 403, "AUTH_FORBIDDEN", "Forbidden");
  });

  it("fails closed with exact 401 when Users application is omitted despite an ADMIN session", async () => {
    const app = await createApp({ sessions: new FixedSessions() });
    apps.push(app);

    const list = await request(app.getHttpServer())
      .get("/api/v1/users")
      .set("Cookie", ADMIN_COOKIE);
    expectExactError(list, 401, "AUTH_UNAUTHENTICATED", "Authentication required");

    const unsafe = await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Cookie", ADMIN_COOKIE)
      .set(VALID_CSRF)
      .send({ email: "viewer@example.com", password: "replacement password" });
    expectExactError(unsafe, 401, "AUTH_UNAUTHENTICATED", "Authentication required");
  });

  it("does not register GET /users/:id and never invokes the Users port for it", async () => {
    const users = new StatefulUsers();
    const app = await createApp({ users, sessions: new FixedSessions() });
    apps.push(app);

    await request(app.getHttpServer())
      .get(`/api/v1/users/${VIEWER_ID}`)
      .set("Cookie", ADMIN_COOKIE)
      .expect(404);
    expect(users.calls).toEqual([]);
  });
});
