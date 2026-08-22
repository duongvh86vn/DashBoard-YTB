import type { ChannelUnitOfWork, VideoRecord } from "@yt-monitor/db";
import type { ProviderVideoStats } from "@yt-monitor/shared";

import { snapshotBucket } from "./snapshot-bucket.js";

export interface VideoStatsProvider {
  getVideoStats(videoIds: string[]): Promise<ProviderVideoStats[]>;
}

export interface VideoSnapshotJobDependencies {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  statsProvider: VideoStatsProvider;
  now?: () => Date;
}

export interface VideoSnapshotResult {
  videoId: string;
  captured: boolean;
  bucket: Date;
}

export class VideoSnapshotJob {
  constructor(private readonly dependencies: VideoSnapshotJobDependencies) {}

  async run(
    video: Pick<VideoRecord, "id" | "channelId" | "youtubeVideoId">,
  ): Promise<VideoSnapshotResult> {
    const capturedAt = (this.dependencies.now ?? (() => new Date()))();
    const bucket = snapshotBucket(capturedAt);
    const stats = (await this.dependencies.statsProvider.getVideoStats([video.youtubeVideoId]))[0];
    const values = {
      views: stats?.viewCount ?? null,
      likes: stats?.likeCount ?? null,
      comments: stats?.commentCount ?? null,
    };
    await this.dependencies.unitOfWork.transaction(async ({ videoSnapshots, videos }) => {
      await videoSnapshots.upsert({
        videoId: video.id,
        channelId: video.channelId,
        capturedAt: stats?.capturedAt ?? capturedAt,
        snapshotBucket: bucket,
        ...values,
        source: "YTDLP",
      });
      await videos.updateCurrentStats(video.id, values);
    });
    return { videoId: video.id, captured: true, bucket };
  }
}
