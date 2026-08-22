import type { ChannelRecord } from "@yt-monitor/db";
import type { ProviderVideo } from "@yt-monitor/shared";
import type { RssVideoItem } from "@yt-monitor/collector-youtube-rss";

export interface DiscoveredVideo {
  youtubeVideoId: string;
  channelId: string;
  title: string | null;
  description: string | null;
  thumbnail: string | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
}

export interface VideoDiscoveryRepository {
  upsertDiscovered(video: DiscoveredVideo, seenAt: Date): Promise<unknown>;
}

export interface VideoDiscoveryJobDependencies {
  repository: VideoDiscoveryRepository;
  rssDiscover: (channel: ChannelRecord) => Promise<{ items: RssVideoItem[] }>;
  ytdlpList: (channel: ChannelRecord) => Promise<ProviderVideo[]>;
  now?: () => Date;
}

export interface VideoDiscoveryResult {
  discovered: number;
  rssCount: number;
  ytdlpCount: number;
  rssFailed: boolean;
}

function fromRss(channelId: string, item: RssVideoItem): DiscoveredVideo {
  return {
    youtubeVideoId: item.videoId,
    channelId,
    title: item.title,
    description: null,
    thumbnail: null,
    publishedAt: item.publishedAt,
    durationSeconds: null,
  };
}

function fromYtdlp(channelId: string, video: ProviderVideo): DiscoveredVideo {
  return {
    youtubeVideoId: video.videoId,
    channelId,
    title: video.title,
    description: video.description,
    thumbnail: video.thumbnail,
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
  };
}

export class VideoDiscoveryJob {
  constructor(private readonly dependencies: VideoDiscoveryJobDependencies) {}

  async run(
    channel: ChannelRecord,
    options: { includeYtdlp?: boolean } = {},
  ): Promise<VideoDiscoveryResult> {
    const seenAt = (this.dependencies.now ?? (() => new Date()))();
    const discovered = new Map<string, DiscoveredVideo>();
    let rssCount = 0;
    let rssFailed = false;
    try {
      const rss = await this.dependencies.rssDiscover(channel);
      rssCount = rss.items.length;
      for (const item of rss.items) discovered.set(item.videoId, fromRss(channel.id, item));
    } catch {
      rssFailed = true;
    }

    let ytdlpCount = 0;
    if (options.includeYtdlp === false) {
      for (const video of discovered.values()) {
        await this.dependencies.repository.upsertDiscovered(video, seenAt);
      }
      return { discovered: discovered.size, rssCount, ytdlpCount, rssFailed };
    }
    try {
      const videos = await this.dependencies.ytdlpList(channel);
      ytdlpCount = videos.length;
      for (const video of videos) {
        if (video.channelId !== channel.youtubeChannelId) continue;
        const existing = discovered.get(video.videoId);
        discovered.set(
          video.videoId,
          existing
            ? { ...existing, ...fromYtdlp(channel.id, video) }
            : fromYtdlp(channel.id, video),
        );
      }
    } catch {
      // Discovery remains best-effort; a later scheduled reconciliation retries it.
    }

    for (const video of discovered.values()) {
      await this.dependencies.repository.upsertDiscovered(video, seenAt);
    }
    return { discovered: discovered.size, rssCount, ytdlpCount, rssFailed };
  }
}
