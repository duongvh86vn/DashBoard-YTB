import { describe, expect, it } from "vitest";

import type { WorkerHeartbeatRecord } from "@yt-monitor/db";

import { evaluateWorkerHealth, type HeartbeatReader } from "./worker-healthcheck.js";

class WorkerScopedHeartbeatReader implements HeartbeatReader {
  readonly requests: Array<{ workerId: string; maxAgeSeconds: number }> = [];

  constructor(private readonly heartbeats: ReadonlyMap<string, WorkerHeartbeatRecord>) {}

  async getRunningHeartbeat(
    workerId: string,
    maxAgeSeconds: number,
  ): Promise<WorkerHeartbeatRecord | null> {
    this.requests.push({ workerId, maxAgeSeconds });
    return this.heartbeats.get(workerId) ?? null;
  }
}

describe("worker healthcheck", () => {
  const workerA: WorkerHeartbeatRecord = {
    workerId: "worker-a",
    version: "0.1.0",
    status: "RUNNING",
    lastSeenAt: new Date("2026-08-21T00:00:00.000Z"),
  };

  it("returns success only for the requested worker instance", async () => {
    const reader = new WorkerScopedHeartbeatReader(new Map([[workerA.workerId, workerA]]));

    expect(await evaluateWorkerHealth(reader, "worker-a", 45)).toBe(true);
    expect(reader.requests).toEqual([{ workerId: "worker-a", maxAgeSeconds: 45 }]);
  });

  it("does not let another healthy worker mask the requested worker", async () => {
    const reader = new WorkerScopedHeartbeatReader(new Map([[workerA.workerId, workerA]]));

    expect(await evaluateWorkerHealth(reader, "worker-b", 45)).toBe(false);
  });
});
