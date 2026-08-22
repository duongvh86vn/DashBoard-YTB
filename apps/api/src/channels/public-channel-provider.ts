import { resolveChannelWithYtdlp, type YtdlpRunner } from "@yt-monitor/collector-ytdlp";
import { YoutubePublicPageProvider } from "@yt-monitor/collector-youtube-public";
import type {
  CanonicalChannel,
  ChannelCurrentStats,
  ProviderVideo,
  ProviderVideoStats,
  PublicChannelProvider,
  ResolvedChannel,
} from "@yt-monitor/shared";

export class CompositePublicChannelProvider implements PublicChannelProvider {
  constructor(
    private readonly ytdlpRunner?: YtdlpRunner,
    private readonly publicFallback = new YoutubePublicPageProvider(),
  ) {}

  async resolveChannel(input: string): Promise<ResolvedChannel | null> {
    try {
      const resolved = await resolveChannelWithYtdlp(input, this.ytdlpRunner);
      if (resolved !== null) return resolved;
    } catch {
      // A public fallback is allowed to verify a channel when yt-dlp is unavailable.
    }
    return this.publicFallback.resolveChannel(input);
  }

  async getChannelCurrentStats(channel: CanonicalChannel): Promise<ChannelCurrentStats | null> {
    void channel;
    return null;
  }

  async listRecentVideos(channel: CanonicalChannel): Promise<ProviderVideo[]> {
    void channel;
    return [];
  }

  async getVideoStats(videoIds: string[]): Promise<ProviderVideoStats[]> {
    void videoIds;
    return [];
  }
}
