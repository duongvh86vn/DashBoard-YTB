import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { HealthRepository } from "./health.repository.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database integration tests");
}

const client = createPrismaClient(databaseUrl);
const repository = new HealthRepository(client);

describe("HealthRepository", () => {
  afterAll(async () => {
    await client.$disconnect();
  });

  it("returns a non-negative latency after PostgreSQL answers SELECT 1", async () => {
    const result = await repository.pingDatabase();

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
