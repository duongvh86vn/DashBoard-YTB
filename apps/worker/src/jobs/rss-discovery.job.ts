import { parseYoutubeRss, type RssVideoItem } from "@yt-monitor/collector-youtube-rss";
import type { ChannelRecord } from "@yt-monitor/db";

export interface RssDiscoveryJobDependencies {
  fetchFeed: (channelId: string) => Promise<string>;
  parseFeed: (xml: string) => { channelId: string; items: RssVideoItem[] };
}

export interface RssDiscoveryResult {
  channelId: string;
  items: RssVideoItem[];
  deduplicatedCount: number;
}

export class RssDiscoveryJob {
  constructor(
    private readonly dependencies: RssDiscoveryJobDependencies = {
      fetchFeed: async () => {
        throw new Error("RSS fetch dependency is not configured");
      },
      parseFeed: parseYoutubeRss,
    },
  ) {}

  async run(channel: Pick<ChannelRecord, "youtubeChannelId">): Promise<RssDiscoveryResult> {
    const xml = await this.dependencies.fetchFeed(channel.youtubeChannelId);
    const feed = this.dependencies.parseFeed(xml);
    if (feed.channelId !== channel.youtubeChannelId) {
      throw new Error("RSS feed channel id did not match the monitored channel");
    }
    const items = new Map<string, RssVideoItem>();
    for (const item of feed.items) {
      if (!items.has(item.videoId)) items.set(item.videoId, item);
    }
    return {
      channelId: channel.youtubeChannelId,
      items: [...items.values()],
      deduplicatedCount: feed.items.length - items.size,
    };
  }
}
