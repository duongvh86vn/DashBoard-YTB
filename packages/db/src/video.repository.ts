import type { Prisma as PrismaTypes } from "./generated/prisma/client.js";
import type { VideoMonitorTierValue, VideoRecord, VideoSnapshotRecord } from "./channel-records.js";

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

export interface ListRankingVideosInput {
  channelId?: string;
  channelIds?: readonly string[];
  take?: number;
}

export interface VideoRankingRecord extends VideoRecord {
  snapshots: Array<{
    id: string;
    videoId: string;
    channelId: string;
    capturedAt: Date;
    snapshotBucket: Date;
    views: bigint | null;
    likes: bigint | null;
    comments: bigint | null;
    source:
      | "YOUTUBE_PUBLIC_PAGE"
      | "YTDLP"
      | "YTDLP_CATALOG"
      | "YOUTUBE_RSS"
      | "OPTIONAL_PROVIDER"
      | "DERIVED";
    createdAt: Date;
  }>;
  channel: { id: string; title: string; thumbnail: string | null };
}

export interface VideoCatalogComparisonRecord extends VideoRecord {
  snapshots: VideoSnapshotRecord[];
  channel: { id: string; title: string; thumbnail: string | null };
}

export type PublishedVideoRecord = Pick<VideoRecord, "channelId" | "publishedAt">;

export interface ChannelPublicVideoSummary {
  knownPublicVideos: number;
  durationKnownVideos: number;
  durationSecondsTotal: number;
  publishedVideos: number;
  catalogObservedAt: Date | null;
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

  listPublishedBetween(
    start: Date,
    endExclusive: Date,
    channelIds?: readonly string[],
  ): Promise<PublishedVideoRecord[]> {
    return this.client.video.findMany({
      where: {
        publishedAt: { gte: start, lt: endExclusive },
        ...(channelIds === undefined ? {} : { channelId: { in: [...channelIds] } }),
      },
      orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
      select: { channelId: true, publishedAt: true },
    });
  }

  async summarizePublicCatalog(
    channelId: string,
    start: Date,
    endExclusive: Date,
  ): Promise<ChannelPublicVideoSummary> {
    const publicCatalog = { channelId, isAvailable: true } as const;
    const [catalog, observedCatalog, publishedVideos] = await Promise.all([
      this.client.video.aggregate({
        where: publicCatalog,
        _count: { _all: true, durationSeconds: true },
        _sum: { durationSeconds: true },
      }),
      this.client.video.aggregate({
        where: { channelId },
        _max: { lastSeenAt: true },
      }),
      this.client.video.count({
        where: {
          channelId,
          publishedAt: { gte: start, lt: endExclusive },
        },
      }),
    ]);
    return {
      knownPublicVideos: catalog._count._all,
      durationKnownVideos: catalog._count.durationSeconds,
      durationSecondsTotal: catalog._sum.durationSeconds ?? 0,
      publishedVideos,
      catalogObservedAt: observedCatalog._max.lastSeenAt,
    };
  }

  listForRanking(input: ListRankingVideosInput = {}): Promise<VideoRankingRecord[]> {
    const where = {
      isAvailable: true,
      ...(input.channelId && input.channelIds !== undefined
        ? {
            AND: [{ channelId: input.channelId }, { channelId: { in: [...input.channelIds] } }],
          }
        : input.channelId
          ? { channelId: input.channelId }
          : input.channelIds === undefined
            ? {}
            : { channelId: { in: [...input.channelIds] } }),
    };
    return this.client.video.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: input.take ?? 5_000,
      include: {
        snapshots: {
          orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
          take: 300,
        },
        channel: { select: { id: true, title: true, thumbnail: true } },
      },
    }) as unknown as Promise<VideoRankingRecord[]>;
  }

  listForCatalogComparison(
    channelIds: readonly string[],
    snapshotBuckets: readonly Date[],
  ): Promise<VideoCatalogComparisonRecord[]> {
    if (channelIds.length === 0 || snapshotBuckets.length === 0) return Promise.resolve([]);
    const snapshotWhere = {
      source: "YTDLP_CATALOG" as const,
      snapshotBucket: { in: [...snapshotBuckets] },
    };
    return this.client.video.findMany({
      where: {
        channelId: { in: [...channelIds] },
        snapshots: { some: snapshotWhere },
      },
      orderBy: [{ channelId: "asc" }, { id: "asc" }],
      include: {
        snapshots: {
          where: snapshotWhere,
          orderBy: [{ snapshotBucket: "asc" }, { id: "asc" }],
        },
        channel: { select: { id: true, title: true, thumbnail: true } },
      },
    }) as unknown as Promise<VideoCatalogComparisonRecord[]>;
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
