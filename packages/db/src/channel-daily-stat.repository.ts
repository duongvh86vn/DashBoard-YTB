import type { Prisma } from "./generated/prisma/client.js";

import type { ChannelDailyStatRecord, CoverageStatusValue } from "./channel-records.js";

type ChannelDailyStatClient = Pick<Prisma.TransactionClient, "channelDailyStat">;

export interface UpsertDailyStatInput {
  channelId: string;
  date: Date;
  subscriberCount: bigint | null;
  videoCount: bigint | null;
  lifetimeViewCount: bigint | null;
  subscriberDelta: bigint | null;
  videoDelta: bigint | null;
  viewDelta: bigint | null;
  coverageStatus: CoverageStatusValue;
  sourceSummary: Prisma.InputJsonValue;
}

export class ChannelDailyStatRepository {
  constructor(private readonly client: ChannelDailyStatClient) {}

  findByChannelAndDate(channelId: string, date: Date): Promise<ChannelDailyStatRecord | null> {
    return this.client.channelDailyStat.findUnique({
      where: { channelId_date: { channelId, date } },
    });
  }

  upsert(input: UpsertDailyStatInput): Promise<ChannelDailyStatRecord> {
    const data = {
      subscriberCount: input.subscriberCount,
      videoCount: input.videoCount,
      lifetimeViewCount: input.lifetimeViewCount,
      subscriberDelta: input.subscriberDelta,
      videoDelta: input.videoDelta,
      viewDelta: input.viewDelta,
      coverageStatus: input.coverageStatus,
      sourceSummary: input.sourceSummary,
    };
    return this.client.channelDailyStat.upsert({
      where: { channelId_date: { channelId: input.channelId, date: input.date } },
      create: { channelId: input.channelId, date: input.date, ...data },
      update: data,
    });
  }
}
