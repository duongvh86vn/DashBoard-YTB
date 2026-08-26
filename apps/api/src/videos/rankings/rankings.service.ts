import {
  calculateBreakoutMultiple,
  calculateSmoothedVph,
  calculateVph,
  calculateWeeklyGain,
  rankBreakout,
  rankHot,
  rankWeekly,
  type MetricSnapshot,
} from "@yt-monitor/analytics";
import type { ChannelUnitOfWork, VideoRankingRecord, VideoSnapshotRecord } from "@yt-monitor/db";

import { ChannelApplicationError } from "../../channels/channel-application.error.js";
import type { PublicVideoSnapshot } from "../videos-application.port.js";
import type {
  PublicVideoDetail,
  PublicRankedVideo,
  PublicVideoSnapshotPage,
  VideoRankingPage,
  VideoRankingsApplicationPort,
} from "./rankings-application.port.js";
import type {
  ChannelAccessResolverPort,
  ChannelAccessSubject,
} from "../../channel-groups/channel-groups-application.port.js";

interface RankingsServiceDependencies {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  access: ChannelAccessResolverPort;
  now?: () => Date;
}

interface RankedValues {
  status: "READY" | "WARMING_UP";
  weeklyGain: bigint | null;
  baselineAt: Date | null;
  vph1h: number | null;
  vph3h: number | null;
  vph6h: number | null;
  smoothedVph: number | null;
  breakout24h: number | null;
  breakout48h: number | null;
  breakout7d: number | null;
}

function snapshots(video: VideoRankingRecord): MetricSnapshot[] {
  return video.snapshots.map((snapshot) => ({
    capturedAt: snapshot.capturedAt,
    views: snapshot.views,
  }));
}

function findViewAtAge(video: VideoRankingRecord, ageHours: number): bigint | null {
  if (!video.publishedAt) return null;
  const target = video.publishedAt.getTime() + ageHours * 3_600_000;
  const candidates = video.snapshots.filter(
    (snapshot) =>
      snapshot.views !== null && Math.abs(snapshot.capturedAt.getTime() - target) <= 12 * 3_600_000,
  );
  candidates.sort(
    (left, right) =>
      Math.abs(left.capturedAt.getTime() - target) - Math.abs(right.capturedAt.getTime() - target),
  );
  return candidates[0]?.views ?? null;
}

function comparableViews(
  video: VideoRankingRecord,
  videos: readonly VideoRankingRecord[],
  ageHours: number,
): bigint[] {
  return videos
    .filter(
      (candidate) =>
        candidate.id !== video.id &&
        candidate.channelId === video.channelId &&
        candidate.publishedAt !== null,
    )
    .sort((left, right) => (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0))
    .slice(0, 50)
    .map((candidate) => findViewAtAge(candidate, ageHours))
    .filter((views): views is bigint => views !== null);
}

function toBase(video: VideoRankingRecord): Omit<PublicRankedVideo, "rank"> {
  return {
    id: video.id,
    youtubeVideoId: video.youtubeVideoId,
    channelId: video.channelId,
    channelTitle: video.channel.title,
    title: video.title,
    thumbnail: video.thumbnail,
    publishedAt: video.publishedAt?.toISOString() ?? null,
    currentViews: video.currentViews?.toString() ?? null,
    currentLikes: video.currentLikes?.toString() ?? null,
    currentComments: video.currentComments?.toString() ?? null,
    status: "READY",
    weeklyGain: null,
    baselineAt: null,
    vph1h: null,
    vph3h: null,
    vph6h: null,
    smoothedVph: null,
    breakout24h: null,
    breakout48h: null,
    breakout7d: null,
  };
}

function toDetail(video: VideoRankingRecord): PublicVideoDetail {
  return {
    id: video.id,
    youtubeVideoId: video.youtubeVideoId,
    channelId: video.channelId,
    channelTitle: video.channel.title,
    title: video.title,
    description: video.description,
    thumbnail: video.thumbnail,
    publishedAt: video.publishedAt?.toISOString() ?? null,
    durationSeconds: video.durationSeconds,
    currentViews: video.currentViews?.toString() ?? null,
    currentLikes: video.currentLikes?.toString() ?? null,
    currentComments: video.currentComments?.toString() ?? null,
    monitorTier: video.monitorTier,
    firstSeenAt: video.firstSeenAt.toISOString(),
    lastSeenAt: video.lastSeenAt.toISOString(),
    isAvailable: video.isAvailable,
    isPinned: video.isPinned,
  };
}

function withValues(
  video: VideoRankingRecord,
  values: RankedValues,
): Omit<PublicRankedVideo, "rank"> {
  return {
    ...toBase(video),
    status: values.status,
    weeklyGain: values.weeklyGain?.toString() ?? null,
    baselineAt: values.baselineAt?.toISOString() ?? null,
    vph1h: values.vph1h,
    vph3h: values.vph3h,
    vph6h: values.vph6h,
    smoothedVph: values.smoothedVph,
    breakout24h: values.breakout24h,
    breakout48h: values.breakout48h,
    breakout7d: values.breakout7d,
  };
}

function paginate(
  items: Array<Omit<PublicRankedVideo, "rank">>,
  page: number,
  pageSize: number,
  warmingUpCount = 0,
): VideoRankingPage {
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize).map((item, index) => ({
      ...item,
      rank: offset + index + 1,
    })),
    page,
    pageSize,
    total: items.length,
    warmingUpCount,
  };
}

function toPublicSnapshot(snapshot: VideoSnapshotRecord): PublicVideoSnapshot {
  return {
    id: snapshot.id,
    videoId: snapshot.videoId,
    channelId: snapshot.channelId,
    capturedAt: snapshot.capturedAt.toISOString(),
    snapshotBucket: snapshot.snapshotBucket.toISOString(),
    views: snapshot.views?.toString() ?? null,
    likes: snapshot.likes?.toString() ?? null,
    comments: snapshot.comments?.toString() ?? null,
    source: snapshot.source,
  };
}

export class VideoRankingsService implements VideoRankingsApplicationPort {
  constructor(private readonly dependencies: RankingsServiceDependencies) {}

  async get(input: { videoId: string; subject: ChannelAccessSubject }): Promise<PublicVideoDetail> {
    const visible = await this.dependencies.access.resolveVisibleChannelIds(input.subject);
    const video = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.videos.findById(input.videoId),
    );
    if (video === null || (visible !== null && !visible.includes(video.channelId))) {
      throw ChannelApplicationError.notFound();
    }

    const enriched = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.videos.listForRanking({ channelId: video.channelId, take: 5_000 }),
    );
    const match = enriched.find((candidate) => candidate.id === video.id);
    if (match === undefined) throw ChannelApplicationError.notFound();
    return toDetail(match);
  }

  private async load(input: {
    channelId?: string;
    subject: ChannelAccessSubject;
  }): Promise<VideoRankingRecord[]> {
    const visible = await this.dependencies.access.resolveVisibleChannelIds(input.subject);
    if (input.channelId && visible !== null && !visible.includes(input.channelId)) {
      throw ChannelApplicationError.notFound();
    }
    return this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.videos.listForRanking({
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(visible === null ? {} : { channelIds: visible }),
      }),
    );
  }

  async recent(input: {
    channelId?: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<VideoRankingPage> {
    const videos = await this.load(input);
    const items = videos
      .sort((left, right) => {
        const published = (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0);
        return published || left.id.localeCompare(right.id);
      })
      .map((video) => withValues(video, this.values(video, new Date(), "recent")));
    return paginate(items, input.page, input.pageSize);
  }

  async weekly(input: {
    channelId?: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<VideoRankingPage> {
    const now = (this.dependencies.now ?? (() => new Date()))();
    const videos = await this.load(input);
    const warmingUpCount = videos.filter(
      (video) => calculateWeeklyGain({ snapshots: snapshots(video), now }).status === "WARMING_UP",
    ).length;
    const ranked = rankWeekly(
      videos.map((video) => ({ ...video, snapshots: snapshots(video) })),
      now,
    );
    const byId = new Map(videos.map((video) => [video.id, video]));
    const items = ranked.map((video) => {
      const original = byId.get(video.id);
      if (!original) throw new Error("Ranking candidate disappeared");
      return withValues(original, {
        ...this.values(original, now, "weekly"),
        status: "READY",
        weeklyGain: video.weeklyGain,
        baselineAt: video.baselineAt,
      });
    });
    return paginate(items, input.page, input.pageSize, warmingUpCount);
  }

  async hot(input: {
    channelId?: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<VideoRankingPage> {
    const now = (this.dependencies.now ?? (() => new Date()))();
    const videos = await this.load(input);
    const candidates = videos.map((video) => {
      const points = snapshots(video);
      return {
        video,
        vph1h: calculateVph(points, 1),
        vph3h: calculateVph(points, 3),
      };
    });
    const ranked = rankHot(
      candidates.map((candidate) => ({
        id: candidate.video.id,
        vph1h: candidate.vph1h,
        vph3h: candidate.vph3h,
      })),
    );
    const byId = new Map(candidates.map((candidate) => [candidate.video.id, candidate]));
    const items = ranked.map((rankedVideo) => {
      const candidate = byId.get(rankedVideo.id);
      if (!candidate) throw new Error("Ranking candidate disappeared");
      return withValues(candidate.video, {
        ...this.values(candidate.video, now, "hot"),
        vph1h: candidate.vph1h,
        vph3h: candidate.vph3h,
        smoothedVph: rankedVideo.smoothedVph,
      });
    });
    return paginate(items, input.page, input.pageSize);
  }

  async breakout(input: {
    channelId?: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<VideoRankingPage> {
    const now = (this.dependencies.now ?? (() => new Date()))();
    const videos = await this.load(input);
    const candidates = videos.map((video) => ({
      video,
      breakout24h: calculateBreakoutMultiple(
        findViewAtAge(video, 24),
        comparableViews(video, videos, 24),
      ),
      breakout48h: calculateBreakoutMultiple(
        findViewAtAge(video, 48),
        comparableViews(video, videos, 48),
      ),
      breakout7d: calculateBreakoutMultiple(
        findViewAtAge(video, 168),
        comparableViews(video, videos, 168),
      ),
    }));
    const ranked = rankBreakout(
      candidates.map((candidate) => ({ id: candidate.video.id, breakout: candidate.breakout48h })),
    );
    const byId = new Map(candidates.map((candidate) => [candidate.video.id, candidate]));
    const items = ranked.map((rankedVideo) => {
      const candidate = byId.get(rankedVideo.id);
      if (!candidate) throw new Error("Ranking candidate disappeared");
      return withValues(candidate.video, {
        ...this.values(candidate.video, now, "breakout"),
        breakout24h: candidate.breakout24h,
        breakout48h: candidate.breakout48h,
        breakout7d: candidate.breakout7d,
      });
    });
    return paginate(items, input.page, input.pageSize);
  }

  async snapshots(input: {
    videoId: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<PublicVideoSnapshotPage> {
    const visible = await this.dependencies.access.resolveVisibleChannelIds(input.subject);
    const result = await this.dependencies.unitOfWork.transaction(
      async ({ videos, videoSnapshots }) => {
        const video = await videos.findById(input.videoId);
        if (video === null || (visible !== null && !visible.includes(video.channelId))) {
          throw ChannelApplicationError.notFound();
        }
        const [items, total] = await Promise.all([
          videoSnapshots.list(input.videoId, input.pageSize, (input.page - 1) * input.pageSize),
          videoSnapshots.count(input.videoId),
        ]);
        return { items, total };
      },
    );
    return {
      items: result.items.map(toPublicSnapshot),
      page: input.page,
      pageSize: input.pageSize,
      total: result.total,
    };
  }

  private values(
    video: VideoRankingRecord,
    now: Date,
    mode: "recent" | "weekly" | "hot" | "breakout",
  ): RankedValues {
    void now;
    void mode;
    return {
      status: "READY",
      weeklyGain: null,
      baselineAt: null,
      vph1h: calculateVph(snapshots(video), 1),
      vph3h: calculateVph(snapshots(video), 3),
      vph6h: calculateVph(snapshots(video), 6),
      smoothedVph: calculateSmoothedVph({
        vph1h: calculateVph(snapshots(video), 1),
        vph3h: calculateVph(snapshots(video), 3),
      }),
      breakout24h: null,
      breakout48h: null,
      breakout7d: null,
    };
  }
}
