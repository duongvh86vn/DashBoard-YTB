import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { WorkerHeartbeatRecord } from "@yt-monitor/db";
import { HealthResponseSchema } from "@yt-monitor/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HealthController } from "./health.controller.js";
import {
  HealthService,
  type DatabaseHealthReader,
  type WorkerHeartbeatReader,
} from "./health.service.js";

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

async function createHealthApp(
  database: DatabaseHealthReader,
  worker: WorkerHeartbeatReader,
): Promise<INestApplication> {
  const healthService = new HealthService(database, worker, "0.1.0", 45);
  const module = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: HealthService, useValue: healthService }],
  }).compile();

  const healthApp = module.createNestApplication();
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

  it("serves aggregate health with no-store caching", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/health").expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(HealthResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body).toMatchObject({ service: "api", status: "ok" });
  });

  it("reports AI as optional and disabled in Phase 0", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/health/ai").expect(200);

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
