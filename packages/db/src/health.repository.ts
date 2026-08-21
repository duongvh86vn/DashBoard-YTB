import type { DatabaseClient } from "./client.js";

export class HealthRepository {
  constructor(private readonly client: DatabaseClient) {}

  async pingDatabase(): Promise<{ latencyMs: number }> {
    const startedAt = performance.now();
    await this.client.$queryRaw`SELECT 1`;

    return { latencyMs: Math.max(0, performance.now() - startedAt) };
  }
}
