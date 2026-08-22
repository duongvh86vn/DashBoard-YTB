import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PublicUser } from "@yt-monitor/auth";
import type { ApiEnv } from "@yt-monitor/config";
import type { WorkerHeartbeatRecord } from "@yt-monitor/db";
import { HealthResponseSchema } from "@yt-monitor/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import type {
  AuthenticatedPrincipal,
  SessionAuthenticationPort,
} from "../auth/session-authentication.port.js";
import { type DatabaseHealthReader, type WorkerHeartbeatReader } from "./health.service.js";

const ALLOWED_ORIGIN = "http://127.0.0.1:3000";
const ADMIN_TOKEN = "a".repeat(43);
const VIEWER_TOKEN = "v".repeat(43);

const TEST_ENV: ApiEnv = {
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
};

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

const UNAUTHENTICATED_BODY = {
  error: { code: "AUTH_UNAUTHENTICATED", message: "Authentication required" },
};

const FORBIDDEN_BODY = {
  error: { code: "AUTH_FORBIDDEN", message: "Forbidden" },
};

class AvailableDatabase implements DatabaseHealthReader {
  async pingDatabase(): Promise<{ latencyMs: number }> {
    return { latencyMs: 2 };
  }
}

class FailingDatabase implements DatabaseHealthReader {
  async pingDatabase(): Promise<{ latencyMs: number }> {
    throw new Error("database unavailable");
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

class StaleWorker implements WorkerHeartbeatReader {
  async getFreshestRunningHeartbeat(): Promise<null> {
    return null;
  }
}

class HealthSessionAuthenticator implements SessionAuthenticationPort {
  async authenticate(token: string): Promise<AuthenticatedPrincipal | null> {
    if (token === ADMIN_TOKEN) {
      return { user: ADMIN_USER, session: { id: "admin-session-id" } };
    }

    if (token === VIEWER_TOKEN) {
      return { user: VIEWER_USER, session: { id: "viewer-session-id" } };
    }

    return null;
  }
}

async function createHealthApp(
  database: DatabaseHealthReader,
  worker: WorkerHeartbeatReader,
): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [
      AppModule.forTesting({
        env: TEST_ENV,
        databaseHealthReader: database,
        workerHeartbeatReader: worker,
        sessionAuthenticator: new HealthSessionAuthenticator(),
      }),
    ],
  }).compile();

  const healthApp = module.createNestApplication({ logger: false });
  healthApp.setGlobalPrefix("api/v1");
  await healthApp.init();
  return healthApp;
}

describe("health HTTP API", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createHealthApp(new AvailableDatabase(), new AvailableWorker());
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(["/health", "/health/db", "/health/worker", "/health/collectors", "/health/ai"])(
    "returns the exact unauthenticated policy response for anonymous GET %s",
    async (path) => {
      const response = await request(app.getHttpServer()).get(`/api/v1${path}`);

      expect(response.status).toBe(401);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual(UNAUTHENTICATED_BODY);
    },
  );

  it.each(["/health", "/health/db", "/health/worker", "/health/collectors", "/health/ai"])(
    "returns the exact forbidden policy response for VIEWER GET %s",
    async (path) => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1${path}`)
        .set("Cookie", `yhm_session=${VIEWER_TOKEN}`);

      expect(response.status).toBe(403);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual(FORBIDDEN_BODY);
    },
  );

  it.each([
    ["/health", "api", "ok"],
    ["/health/db", "database", "ok"],
    ["/health/worker", "worker", "ok"],
    ["/health/collectors", "collectors", "disabled"],
    ["/health/ai", "ai", "disabled"],
  ])("preserves the Phase 0 ADMIN response for GET %s", async (path, service, status) => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set("Cookie", `yhm_session=${ADMIN_TOKEN}`)
      .expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(HealthResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body).toMatchObject({ service, status });
  });

  it("reports AI as optional and disabled in Phase 0 for ADMIN", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health/ai")
      .set("Cookie", `yhm_session=${ADMIN_TOKEN}`)
      .expect(200);

    expect(response.body).toMatchObject({
      service: "ai",
      status: "disabled",
      checks: { ai: { status: "disabled", required: false, code: "AI_DISABLED" } },
    });
  });

  it("serves a schema-valid database 503 with a stable code and no-store caching", async () => {
    const unavailableApp = await createHealthApp(new FailingDatabase(), new AvailableWorker());

    try {
      const response = await request(unavailableApp.getHttpServer())
        .get("/api/v1/health/db")
        .set("Cookie", `yhm_session=${ADMIN_TOKEN}`)
        .expect(503);

      expect(response.headers["cache-control"]).toBe("no-store");
      expect(HealthResponseSchema.safeParse(response.body).success).toBe(true);
      expect(response.body).toMatchObject({
        service: "database",
        status: "unavailable",
        checks: {
          database: {
            status: "unavailable",
            required: true,
            code: "DATABASE_UNAVAILABLE",
          },
        },
      });
    } finally {
      await unavailableApp.close();
    }
  });

  it("serves a schema-valid stale-worker 503 with a stable code and no-store caching", async () => {
    const unavailableApp = await createHealthApp(new AvailableDatabase(), new StaleWorker());

    try {
      const response = await request(unavailableApp.getHttpServer())
        .get("/api/v1/health/worker")
        .set("Cookie", `yhm_session=${ADMIN_TOKEN}`)
        .expect(503);

      expect(response.headers["cache-control"]).toBe("no-store");
      expect(HealthResponseSchema.safeParse(response.body).success).toBe(true);
      expect(response.body).toMatchObject({
        service: "worker",
        status: "unavailable",
        checks: {
          worker: {
            status: "unavailable",
            required: true,
            code: "WORKER_HEARTBEAT_STALE",
          },
        },
      });
    } finally {
      await unavailableApp.close();
    }
  });
});
