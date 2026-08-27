import type { Prisma } from "./generated/prisma/client.js";

import type { CoverageStatusValue, VideoCatalogScanRecord } from "./channel-records.js";

type VideoCatalogScanClient = Pick<Prisma.TransactionClient, "videoCatalogScan">;

export interface CreateVideoCatalogScanInput {
  channelId: string;
  date: Date;
  capturedAt: Date;
  snapshotBucket: Date;
  totalVideos: number;
  videosWithViews: number;
  coverageStatus: CoverageStatusValue;
}

export class VideoCatalogScanRepository {
  constructor(private readonly client: VideoCatalogScanClient) {}

  findByChannelAndDate(channelId: string, date: Date): Promise<VideoCatalogScanRecord | null> {
    return this.client.videoCatalogScan.findUnique({
      where: { channelId_date: { channelId, date } },
    });
  }

  listByChannelsAndDateRange(
    channelIds: readonly string[],
    startDate: Date,
    endDate: Date,
  ): Promise<VideoCatalogScanRecord[]> {
    if (channelIds.length === 0) return Promise.resolve([]);
    return this.client.videoCatalogScan.findMany({
      where: {
        channelId: { in: [...channelIds] },
        date: { gte: startDate, lte: endDate },
      },
      orderBy: [{ date: "asc" }, { channelId: "asc" }],
    });
  }

  async createIfAbsent(input: CreateVideoCatalogScanInput): Promise<{
    created: boolean;
    record: VideoCatalogScanRecord;
  }> {
    const data = {
      channelId: input.channelId,
      date: input.date,
      capturedAt: input.capturedAt,
      snapshotBucket: input.snapshotBucket,
      totalVideos: input.totalVideos,
      videosWithViews: input.videosWithViews,
      coverageStatus: input.coverageStatus,
    } as const;
    const result = await this.client.videoCatalogScan.createMany({
      data,
      skipDuplicates: true,
    });
    const record = await this.client.videoCatalogScan.findUnique({
      where: { channelId_date: { channelId: input.channelId, date: input.date } },
    });
    if (record === null) throw new Error("Daily video catalog claim was not persisted");
    return { created: result.count === 1, record };
  }
}
