import type { Prisma } from "./generated/prisma/client.js";

import type { SyncRunJobTypeValue, SyncRunRecord, SyncRunStatusValue } from "./channel-records.js";

type SyncRunClient = Pick<Prisma.TransactionClient, "syncRun">;

export interface CreateSyncRunInput {
  channelId?: string | null;
  jobType: SyncRunJobTypeValue;
  status: SyncRunStatusValue;
  startedAt?: Date | null;
}

export class SyncRunRepository {
  constructor(private readonly client: SyncRunClient) {}

  create(input: CreateSyncRunInput): Promise<SyncRunRecord> {
    return this.client.syncRun.create({
      data: {
        channelId: input.channelId ?? null,
        jobType: input.jobType,
        status: input.status,
        startedAt: input.startedAt ?? null,
      },
    });
  }

  findQueuedHealth(channelId: string): Promise<SyncRunRecord | null> {
    return this.client.syncRun.findFirst({
      where: { channelId, jobType: "CHANNEL_HEALTH", status: "QUEUED" },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    });
  }

  markRunning(id: string, startedAt: Date): Promise<SyncRunRecord> {
    return this.client.syncRun.update({
      where: { id },
      data: { status: "RUNNING", startedAt },
    });
  }

  complete(
    id: string,
    input: {
      status: SyncRunStatusValue;
      completedAt: Date;
      recordsProcessed?: number | null;
      errorCode?: string | null;
      errorMessageSafe?: string | null;
    },
  ): Promise<SyncRunRecord> {
    return this.client.syncRun.update({
      where: { id },
      data: {
        status: input.status,
        completedAt: input.completedAt,
        recordsProcessed: input.recordsProcessed ?? null,
        errorCode: input.errorCode ?? null,
        errorMessageSafe: input.errorMessageSafe ?? null,
      },
    });
  }
}
