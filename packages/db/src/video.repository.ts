import type { Prisma as PrismaTypes } from "./generated/prisma/client.js";
import type { VideoMonitorTierValue, VideoRecord } from "./channel-records.js";

type VideoClient = Pick<PrismaTypes.TransactionClient, "video">;

export interface UpsertVideoInput {
  youtubeVideoId: string;
  channelId: string;
  title: string | null;
  description: string | null;
  thumbnail: string | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
  seenAt: Date;
}

export interface VideoPage {
  items: VideoRecord[];
  total: number;
}

export interface ListVideosInput {
  channelId?: string;
  page: number;
  pageSize: number;
}

export class VideoRepository {
  constructor(private readonly client: VideoClient) {}

  findById(id: string): Promise<VideoRecord | null> {
    return this.client.video.findUnique({ where: { id } });
  }

  findByYoutubeVideoId(youtubeVideoId: string): Promise<VideoRecord | null> {
    return this.client.video.findUnique({ where: { youtubeVideoId } });
  }

  async upsertDiscovered(input: UpsertVideoInput): Promise<VideoRecord> {
    return this.client.video.upsert({
      where: { youtubeVideoId: input.youtubeVideoId },
      create: {
        youtubeVideoId: input.youtubeVideoId,
        channelId: input.channelId,
        title: input.title,
        description: input.description,
        thumbnail: input.thumbnail,
        publishedAt: input.publishedAt,
        durationSeconds: input.durationSeconds,
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
        isAvailable: true,
      },
      update: {
        channelId: input.channelId,
        title: input.title,
        description: input.description,
        thumbnail: input.thumbnail,
        publishedAt: input.publishedAt,
        durationSeconds: input.durationSeconds,
        lastSeenAt: input.seenAt,
        isAvailable: true,
      },
    });
  }

  async list(input: ListVideosInput): Promise<VideoPage> {
    const where = input.channelId ? { channelId: input.channelId } : {};
    const [items, total] = await Promise.all([
      this.client.video.findMany({
        where,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.client.video.count({ where }),
    ]);
    return { items, total };
  }

  listCandidates(tiers: VideoMonitorTierValue[], limit = 500): Promise<VideoRecord[]> {
    return this.client.video.findMany({
      where: { monitorTier: { in: tiers }, isAvailable: true },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: limit,
    });
  }

  updateTier(id: string, monitorTier: VideoMonitorTierValue): Promise<VideoRecord> {
    return this.client.video.update({ where: { id }, data: { monitorTier } });
  }

  updateCurrentStats(
    id: string,
    input: { views: bigint | null; likes: bigint | null; comments: bigint | null },
  ): Promise<VideoRecord> {
    return this.client.video.update({
      where: { id },
      data: {
        currentViews: input.views,
        currentLikes: input.likes,
        currentComments: input.comments,
      },
    });
  }
}
