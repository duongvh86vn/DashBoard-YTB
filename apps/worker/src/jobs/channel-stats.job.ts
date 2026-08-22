import type { PublicChannelProvider } from "@yt-monitor/shared";
import { deriveActivityStatus } from "@yt-monitor/shared";
import type { ChannelUnitOfWork, ChannelRecord } from "@yt-monitor/db";

export interface ChannelStatsJobDependencies {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  provider: Pick<PublicChannelProvider, "getChannelCurrentStats">;
  now?: () => Date;
  activeUploadDays?: number;
}

export class ChannelStatsJob {
  constructor(private readonly dependencies: ChannelStatsJobDependencies) {}

  async run(channel: ChannelRecord): Promise<"SUCCESS" | "PARTIAL"> {
    const capturedAt = (this.dependencies.now ?? (() => new Date()))();
    const stats = await this.dependencies.provider.getChannelCurrentStats({
      id: channel.id,
      youtubeChannelId: channel.youtubeChannelId,
      canonicalUrl: channel.canonicalUrl,
      handle: channel.handle,
      title: channel.title,
    });
    if (stats === null) return "PARTIAL";
    await this.dependencies.unitOfWork.transaction(async (repositories) => {
      await repositories.channels.createSnapshot({
        channelId: channel.id,
        capturedAt,
        subscriberCount: stats.subscriberCount,
        videoCount: stats.videoCount,
        lifetimeViewCount: stats.lifetimeViewCount,
        lastUploadAt: stats.lastUploadAt,
        source: stats.source,
        sourceDetails: stats.sourceDetails,
      });
      await repositories.channels.updateCurrentStats(channel.id, {
        capturedAt,
        subscriberCount: stats.subscriberCount,
        videoCount: stats.videoCount,
        lifetimeViewCount: stats.lifetimeViewCount,
        lastUploadAt: stats.lastUploadAt,
        source: stats.source,
        sourceDetails: stats.sourceDetails,
        activityStatus: deriveActivityStatus(
          stats.lastUploadAt,
          capturedAt,
          this.dependencies.activeUploadDays ?? 30,
        ),
      });
    });
    return "SUCCESS";
  }
}
