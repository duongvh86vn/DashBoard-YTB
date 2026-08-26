import type { ChannelUnitOfWork, VideoRecord, VideoSnapshotRecord } from "@yt-monitor/db";
import { ChannelApplicationError } from "../channels/channel-application.error.js";
import type {
  PublicVideo,
  PublicVideoSnapshot,
  VideosApplicationPort,
} from "./videos-application.port.js";
import type {
  ChannelAccessResolverPort,
  ChannelAccessSubject,
} from "../channel-groups/channel-groups-application.port.js";

interface VideosServiceDependencies {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  access: ChannelAccessResolverPort;
}

function toPublicVideo(video: VideoRecord): PublicVideo {
  return {
    id: video.id,
    youtubeVideoId: video.youtubeVideoId,
    channelId: video.channelId,
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

export class VideosService implements VideosApplicationPort {
  constructor(private readonly dependencies: VideosServiceDependencies) {}

  private async assertVisible(channelId: string, subject: ChannelAccessSubject): Promise<void> {
    const visible = await this.dependencies.access.resolveVisibleChannelIds(subject);
    if (visible !== null && !visible.includes(channelId)) throw ChannelApplicationError.notFound();
  }

  async listRecent(input: {
    channelId: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }) {
    await this.assertVisible(input.channelId, input.subject);
    const result = await this.dependencies.unitOfWork.transaction(async ({ channels, videos }) => {
      if ((await channels.findById(input.channelId)) === null)
        throw ChannelApplicationError.notFound();
      return videos.list({
        channelId: input.channelId,
        page: input.page,
        pageSize: input.pageSize,
      });
    });
    return {
      items: result.items.map(toPublicVideo),
      page: input.page,
      pageSize: input.pageSize,
      total: result.total,
    };
  }

  async snapshots(input: {
    channelId: string;
    videoId: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }) {
    await this.assertVisible(input.channelId, input.subject);
    const result = await this.dependencies.unitOfWork.transaction(
      async ({ videos, videoSnapshots }) => {
        const video = await videos.findById(input.videoId);
        if (video === null || video.channelId !== input.channelId)
          throw ChannelApplicationError.notFound();
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
}
