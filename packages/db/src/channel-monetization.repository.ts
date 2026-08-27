import type { Prisma } from "./generated/prisma/client.js";

import type { ChannelMonetizationSettingRecord } from "./channel-records.js";

type ChannelMonetizationClient = Pick<Prisma.TransactionClient, "channelMonetizationSetting">;

export interface UpsertChannelMonetizationSettingInput {
  channelId: string;
  effectiveDate: Date;
  isMonetized: boolean;
  rpmMicros: bigint | null;
  recordedByUserId: string;
}

export class ChannelMonetizationRepository {
  constructor(private readonly client: ChannelMonetizationClient) {}

  upsert(input: UpsertChannelMonetizationSettingInput): Promise<ChannelMonetizationSettingRecord> {
    const data = {
      isMonetized: input.isMonetized,
      rpmMicros: input.rpmMicros,
      currency: "USD",
      recordedByUserId: input.recordedByUserId,
    } as const;
    return this.client.channelMonetizationSetting.upsert({
      where: {
        channelId_effectiveDate: {
          channelId: input.channelId,
          effectiveDate: input.effectiveDate,
        },
      },
      create: {
        channelId: input.channelId,
        effectiveDate: input.effectiveDate,
        ...data,
      },
      update: data,
    });
  }

  async latestEffectiveForChannel(
    channelId: string,
    effectiveOn: Date,
  ): Promise<ChannelMonetizationSettingRecord | null> {
    return this.client.channelMonetizationSetting.findFirst({
      where: { channelId, effectiveDate: { lte: effectiveOn } },
      orderBy: [{ effectiveDate: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    });
  }

  async latestEffectiveForChannels(
    channelIds: readonly string[],
    effectiveOn: Date,
  ): Promise<ChannelMonetizationSettingRecord[]> {
    if (channelIds.length === 0) return [];
    const rows = await this.client.channelMonetizationSetting.findMany({
      where: { channelId: { in: [...channelIds] }, effectiveDate: { lte: effectiveOn } },
      orderBy: [
        { channelId: "asc" },
        { effectiveDate: "desc" },
        { updatedAt: "desc" },
        { id: "desc" },
      ],
    });
    const latest = new Map<string, ChannelMonetizationSettingRecord>();
    for (const row of rows) {
      if (!latest.has(row.channelId)) latest.set(row.channelId, row);
    }
    return [...latest.values()];
  }

  async listEffectiveThroughDate(
    channelIds: readonly string[],
    effectiveThrough: Date,
  ): Promise<ChannelMonetizationSettingRecord[]> {
    if (channelIds.length === 0) return [];
    return this.client.channelMonetizationSetting.findMany({
      where: {
        channelId: { in: [...channelIds] },
        effectiveDate: { lte: effectiveThrough },
      },
      orderBy: [{ channelId: "asc" }, { effectiveDate: "asc" }, { updatedAt: "asc" }],
    });
  }
}
