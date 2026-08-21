import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HeartbeatWrite } from "@yt-monitor/db";

import { HeartbeatService, type HeartbeatWriter } from "./heartbeat.service.js";

class RecordingHeartbeatWriter implements HeartbeatWriter {
  readonly writes: HeartbeatWrite[] = [];

  async upsertHeartbeat(input: HeartbeatWrite): Promise<void> {
    this.writes.push(input);
  }
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}

describe("HeartbeatService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes immediately and then at the configured interval", async () => {
    const writer = new RecordingHeartbeatWriter();
    const service = new HeartbeatService(writer, "worker-a", "0.1.0", 15_000);

    await service.onApplicationBootstrap();
    expect(writer.writes).toEqual([{ workerId: "worker-a", version: "0.1.0", status: "RUNNING" }]);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(writer.writes).toHaveLength(2);

    await service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(writer.writes).toHaveLength(2);
  });

  it("never overlaps scheduled heartbeat writes", async () => {
    const pendingWrite = deferred();
    let writeCount = 0;
    const writer: HeartbeatWriter = {
      async upsertHeartbeat(): Promise<void> {
        writeCount += 1;
        if (writeCount === 2) {
          await pendingWrite.promise;
        }
      },
    };
    const service = new HeartbeatService(writer, "worker-a", "0.1.0", 15_000);

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(45_000);

    expect(writeCount).toBe(2);

    pendingWrite.resolve();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(writeCount).toBe(3);

    await service.onApplicationShutdown();
  });

  it("catches a failed write and recovers on the next interval", async () => {
    const reportedErrors: unknown[] = [];
    let writeCount = 0;
    const writer: HeartbeatWriter = {
      async upsertHeartbeat(): Promise<void> {
        writeCount += 1;
        if (writeCount === 2) {
          throw new Error("temporary database failure");
        }
      },
    };
    const service = new HeartbeatService(writer, "worker-a", "0.1.0", 15_000, (error) => {
      reportedErrors.push(error);
    });

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(writeCount).toBe(3);
    expect(reportedErrors).toHaveLength(1);

    await service.onApplicationShutdown();
  });

  it("continues scheduling when the immediate heartbeat fails", async () => {
    const reportedErrors: unknown[] = [];
    let writeCount = 0;
    const writer: HeartbeatWriter = {
      async upsertHeartbeat(): Promise<void> {
        writeCount += 1;
        if (writeCount === 1) {
          throw new Error("database still starting");
        }
      },
    };
    const service = new HeartbeatService(writer, "worker-a", "0.1.0", 15_000, (error) => {
      reportedErrors.push(error);
    });

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(writeCount).toBe(2);
    expect(reportedErrors).toHaveLength(1);

    await service.onApplicationShutdown();
  });

  it("waits for an in-flight heartbeat before shutdown completes", async () => {
    const pendingWrite = deferred();
    let writeCount = 0;
    const writer: HeartbeatWriter = {
      async upsertHeartbeat(): Promise<void> {
        writeCount += 1;
        if (writeCount === 2) {
          await pendingWrite.promise;
        }
      },
    };
    const service = new HeartbeatService(writer, "worker-a", "0.1.0", 15_000);

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(15_000);

    let shutdownFinished = false;
    const shutdown = Promise.resolve(service.onApplicationShutdown()).then(() => {
      shutdownFinished = true;
    });
    await vi.runAllTicks();
    expect(shutdownFinished).toBe(false);

    pendingWrite.resolve();
    await shutdown;
    expect(shutdownFinished).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeCount).toBe(2);
  });

  it("bounds shutdown when an in-flight heartbeat never settles", async () => {
    let writeCount = 0;
    const writer: HeartbeatWriter = {
      async upsertHeartbeat(): Promise<void> {
        writeCount += 1;
        if (writeCount === 2) {
          await new Promise<void>(() => {
            // Deliberately pending to model a wedged database write.
          });
        }
      },
    };
    const service = new HeartbeatService(
      writer,
      "worker-a",
      "0.1.0",
      15_000,
      () => undefined,
      2_000,
    );

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(15_000);

    const shutdown = service.onApplicationShutdown();
    let shutdownFinished = false;
    void shutdown.then(() => {
      shutdownFinished = true;
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(shutdownFinished).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(shutdown).resolves.toBeUndefined();
    expect(shutdownFinished).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeCount).toBe(2);
  });
});
