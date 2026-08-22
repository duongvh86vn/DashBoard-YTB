import type { ChannelRecord } from "@yt-monitor/db";
import type { ProviderVideo } from "@yt-monitor/shared";

import type { VideoDiscoveryRepository } from "./discovery.js";

export interface VideoReconcileDependencies {
  repository: VideoDiscoveryRepository;
  listVideos: (channel: ChannelRecord) => Promise<ProviderVideo[]>;
  now?: () => Date;
}

export class VideoReconcileJob {
  constructor(private readonly dependencies: VideoReconcileDependencies) {}

  async run(channel: ChannelRecord): Promise<{ discovered: number; failed: boolean }> {
    try {
      const videos = await this.dependencies.listVideos(channel);
      let discovered = 0;
      for (const video of videos) {
        if (video.channelId !== channel.youtubeChannelId) continue;
        await this.dependencies.repository.upsertDiscovered(
          {
            youtubeVideoId: video.videoId,
            channelId: channel.id,
            title: video.title,
            description: video.description,
            thumbnail: video.thumbnail,
            publishedAt: video.publishedAt,
            durationSeconds: video.durationSeconds,
          },
          (this.dependencies.now ?? (() => new Date()))(),
        );
        discovered += 1;
      }
      return { discovered, failed: false };
    } catch {
      return { discovered: 0, failed: true };
    }
  }
}
