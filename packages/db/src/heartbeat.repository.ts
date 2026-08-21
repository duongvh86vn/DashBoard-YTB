import type { DatabaseClient } from "./client.js";

export interface HeartbeatWrite {
  workerId: string;
  version: string;
  status: "RUNNING";
}

export interface WorkerHeartbeatRecord {
  workerId: string;
  version: string;
  lastSeenAt: Date;
  status: string;
}

export class HeartbeatRepository {
  constructor(private readonly client: DatabaseClient) {}

  async upsertHeartbeat(input: HeartbeatWrite): Promise<void> {
    await this.client.$executeRaw`
      INSERT INTO "worker_heartbeats" (
        "worker_id",
        "version",
        "last_seen_at",
        "status"
      )
      VALUES (
        ${input.workerId},
        ${input.version},
        CURRENT_TIMESTAMP,
        ${input.status}
      )
      ON CONFLICT ("worker_id") DO UPDATE SET
        "version" = EXCLUDED."version",
        "last_seen_at" = CURRENT_TIMESTAMP,
        "status" = EXCLUDED."status"
    `;
  }

  async getFreshestRunningHeartbeat(maxAgeSeconds: number): Promise<WorkerHeartbeatRecord | null> {
    const rows = await this.client.$queryRaw<WorkerHeartbeatRecord[]>`
      SELECT
        "worker_id" AS "workerId",
        "version",
        "last_seen_at" AS "lastSeenAt",
        "status"
      FROM "worker_heartbeats"
      WHERE
        "status" = 'RUNNING'
        AND "last_seen_at" >= CURRENT_TIMESTAMP - (${maxAgeSeconds} * INTERVAL '1 second')
      ORDER BY "last_seen_at" DESC
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  async getRunningHeartbeat(
    workerId: string,
    maxAgeSeconds: number,
  ): Promise<WorkerHeartbeatRecord | null> {
    const rows = await this.client.$queryRaw<WorkerHeartbeatRecord[]>`
      SELECT
        "worker_id" AS "workerId",
        "version",
        "last_seen_at" AS "lastSeenAt",
        "status"
      FROM "worker_heartbeats"
      WHERE
        "worker_id" = ${workerId}
        AND "status" = 'RUNNING'
        AND "last_seen_at" >= CURRENT_TIMESTAMP - (${maxAgeSeconds} * INTERVAL '1 second')
      LIMIT 1
    `;

    return rows[0] ?? null;
  }
}
