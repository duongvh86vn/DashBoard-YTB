import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { HeartbeatRepository } from "./heartbeat.repository.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database integration tests");
}

const client = createPrismaClient(databaseUrl);
const repository = new HeartbeatRepository(client);

describe("HeartbeatRepository", () => {
  beforeEach(async () => {
    await client.workerHeartbeat.deleteMany();
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("keeps one row when the same worker heartbeat is written repeatedly", async () => {
    const input = { workerId: "worker-a", version: "0.1.0", status: "RUNNING" } as const;

    await repository.upsertHeartbeat(input);
    await repository.upsertHeartbeat(input);

    expect(await client.workerHeartbeat.count({ where: { workerId: "worker-a" } })).toBe(1);
    expect(
      await client.workerHeartbeat.findUnique({ where: { workerId: "worker-a" } }),
    ).toMatchObject(input);
  });

  it("uses database time when deciding whether a heartbeat is fresh", async () => {
    await client.workerHeartbeat.create({
      data: {
        workerId: "worker-a",
        version: "0.1.0",
        status: "RUNNING",
        lastSeenAt: new Date("2000-01-01T00:00:00.000Z"),
      },
    });

    expect(await repository.getFreshestRunningHeartbeat(45)).toBeNull();

    await repository.upsertHeartbeat({ workerId: "worker-a", version: "0.1.0", status: "RUNNING" });

    expect(await repository.getFreshestRunningHeartbeat(45)).toMatchObject({
      workerId: "worker-a",
      status: "RUNNING",
    });
  });

  it("selects the requested worker instead of another fresh worker", async () => {
    await repository.upsertHeartbeat({
      workerId: "worker-a",
      version: "0.1.0",
      status: "RUNNING",
    });
    await repository.upsertHeartbeat({
      workerId: "worker-b",
      version: "0.1.0",
      status: "RUNNING",
    });

    expect(await repository.getRunningHeartbeat("worker-b", 45)).toMatchObject({
      workerId: "worker-b",
      status: "RUNNING",
    });
    expect(await repository.getRunningHeartbeat("worker-missing", 45)).toBeNull();
  });
});
