import { describe, expect, it, vi } from "vitest";

import type { WorkerHeartbeatRecord } from "@yt-monitor/db";
import { HealthResponseSchema } from "@yt-monitor/shared";

import {
  HealthService,
  type DatabaseHealthReader,
  type WorkerHeartbeatReader,
} from "./health.service.js";

class AvailableDatabase implements DatabaseHealthReader {
  async pingDatabase(): Promise<{ latencyMs: number }> {
    return { latencyMs: 4 };
  }
}

class FailingDatabase implements DatabaseHealthReader {
  async pingDatabase(): Promise<{ latencyMs: number }> {
    throw new Error("postgresql://secret:secret@postgres/private");
  }
}

function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {
    // Deliberately pending to model a wedged adapter or dependency.
  });
}

class NeverSettlingDatabase implements DatabaseHealthReader {
  pingDatabase(): Promise<{ latencyMs: number }> {
    return neverSettles();
  }
}

class NeverSettlingHeartbeatReader implements WorkerHeartbeatReader {
  getFreshestRunningHeartbeat(): Promise<WorkerHeartbeatRecord | null> {
    return neverSettles();
  }
}

class FixedHeartbeatReader implements WorkerHeartbeatReader {
  constructor(private readonly heartbeat: WorkerHeartbeatRecord | null) {}

  async getFreshestRunningHeartbeat(): Promise<WorkerHeartbeatRecord | null> {
    return this.heartbeat;
  }
}

const heartbeat: WorkerHeartbeatRecord = {
  workerId: "worker-a",
  version: "0.1.0",
  status: "RUNNING",
  lastSeenAt: new Date("2026-08-21T00:00:00.000Z"),
};

describe("HealthService", () => {
  it("returns an OK aggregate when database and worker are available", async () => {
    const service = new HealthService(
      new AvailableDatabase(),
      new FixedHeartbeatReader(heartbeat),
      "0.1.0",
      45,
    );

    const result = await service.getAggregateHealth();

    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("ok");
    expect(result.body.checks).toMatchObject({
      database: { status: "ok", required: true, latencyMs: 4 },
      worker: { status: "ok", required: true },
      collectors: { status: "disabled", required: false, code: "PHASE_NOT_ENABLED" },
      ai: { status: "disabled", required: false, code: "AI_DISABLED" },
    });
    expect(HealthResponseSchema.safeParse(result.body).success).toBe(true);
  });

  it("returns 503 without exposing a database error", async () => {
    const service = new HealthService(
      new FailingDatabase(),
      new FixedHeartbeatReader(heartbeat),
      "0.1.0",
      45,
    );

    const result = await service.getDatabaseHealth();
    const serialized = JSON.stringify(result.body);

    expect(result.httpStatus).toBe(503);
    expect(result.body.status).toBe("unavailable");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("postgresql://");
  });

  it("returns 503 when no fresh worker heartbeat exists", async () => {
    const service = new HealthService(
      new AvailableDatabase(),
      new FixedHeartbeatReader(null),
      "0.1.0",
      45,
    );

    expect(await service.getWorkerHealth()).toMatchObject({
      httpStatus: 503,
      body: { status: "unavailable", checks: { worker: { code: "WORKER_HEARTBEAT_STALE" } } },
    });
    expect((await service.getAggregateHealth()).httpStatus).toBe(503);
  });

  it("bounds a never-settling database health read and returns the stable 503 code", async () => {
    vi.useFakeTimers();

    try {
      const service = new HealthService(
        new NeverSettlingDatabase(),
        new FixedHeartbeatReader(heartbeat),
        "0.1.0",
        45,
        2_000,
      );

      const resultPromise = service.getDatabaseHealth();
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await resultPromise;

      expect(result).toMatchObject({
        httpStatus: 503,
        body: {
          status: "unavailable",
          checks: { database: { code: "DATABASE_UNAVAILABLE" } },
        },
      });
      expect(HealthResponseSchema.safeParse(result.body).success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a never-settling worker health read and returns the stable 503 code", async () => {
    vi.useFakeTimers();

    try {
      const service = new HealthService(
        new AvailableDatabase(),
        new NeverSettlingHeartbeatReader(),
        "0.1.0",
        45,
        2_000,
      );

      const resultPromise = service.getWorkerHealth();
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await resultPromise;

      expect(result).toMatchObject({
        httpStatus: 503,
        body: {
          status: "unavailable",
          checks: { worker: { code: "WORKER_HEALTHCHECK_FAILED" } },
        },
      });
      expect(HealthResponseSchema.safeParse(result.body).success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports Phase 0 collectors and AI as disabled rather than healthy", () => {
    const service = new HealthService(
      new AvailableDatabase(),
      new FixedHeartbeatReader(heartbeat),
      "0.1.0",
      45,
    );

    expect(service.getCollectorsHealth()).toMatchObject({
      httpStatus: 200,
      body: { status: "disabled", checks: { collectors: { status: "disabled" } } },
    });
    expect(service.getAiHealth()).toMatchObject({
      httpStatus: 200,
      body: { status: "disabled", checks: { ai: { status: "disabled" } } },
    });
  });
});
