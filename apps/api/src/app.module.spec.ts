import { Test } from "@nestjs/testing";
import type { ApiEnv } from "@yt-monitor/config";
import type { WorkerHeartbeatRecord } from "@yt-monitor/db";
import { describe, expect, it, vi } from "vitest";

const createPrismaClient = vi.hoisted(() => vi.fn());

vi.mock("@yt-monitor/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@yt-monitor/db")>()),
  createPrismaClient,
}));

import { AppModule } from "./app.module.js";

const testingEnvironment: ApiEnv = {
  NODE_ENV: "test",
  APP_VERSION: "0.1.0",
  APP_TIMEZONE: "Asia/Bangkok",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://unused:unused@invalid.test/unused",
  API_PORT: 5000,
  WORKER_HEARTBEAT_STALE_SECONDS: 45,
  DEPLOYMENT_MODE: "LOCAL",
  APP_PUBLIC_URL: "http://127.0.0.1:3000",
  APP_ALLOWED_ORIGINS: ["http://127.0.0.1:3000"],
  SESSION_SECRET: "s".repeat(32),
  SESSION_IDLE_MINUTES: 120,
  SESSION_ABSOLUTE_HOURS: 24,
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_LOCK_MINUTES: 15,
};

describe("AppModule testing composition seam", () => {
  it("constructs zero Prisma clients while compiling the testing module", async () => {
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forTesting({
          env: testingEnvironment,
          databaseHealthReader: {
            async pingDatabase() {
              return { latencyMs: 1 };
            },
          },
          workerHeartbeatReader: {
            async getFreshestRunningHeartbeat(): Promise<WorkerHeartbeatRecord | null> {
              return null;
            },
          },
        }),
      ],
    }).compile();

    try {
      expect(createPrismaClient).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });
});
