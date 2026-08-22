import { fetchYoutubeRss, parseYoutubeRss } from "@yt-monitor/collector-youtube-rss";
import { getVideoStatsWithYtdlp, listRecentVideosWithYtdlp } from "@yt-monitor/collector-ytdlp";
import type { ChannelRecord, VideoRepository } from "@yt-monitor/db";
import type { ProviderVideoStats } from "@yt-monitor/shared";

import type { VideoDiscoveryRepository } from "./discovery.js";

export function createVideoDiscoveryRepository(
  repository: VideoRepository,
): VideoDiscoveryRepository {
  return {
    upsertDiscovered: (video, seenAt) => repository.upsertDiscovered({ ...video, seenAt }),
  };
}

export function createVideoRuntimeProviders() {
  return {
    rssDiscover: async (channel: ChannelRecord) => {
      const feed = parseYoutubeRss(await fetchYoutubeRss(channel.youtubeChannelId));
      if (feed.channelId !== channel.youtubeChannelId) throw new Error("RSS channel mismatch");
      return { items: feed.items };
    },
    ytdlpList: (channel: ChannelRecord) =>
      listRecentVideosWithYtdlp(channel.canonicalUrl, channel.youtubeChannelId),
    getVideoStats: (videoIds: string[], capturedAt?: Date): Promise<ProviderVideoStats[]> =>
      getVideoStatsWithYtdlp(videoIds, undefined, capturedAt),
  };
}
