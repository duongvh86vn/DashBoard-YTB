import {
  checkPublicChannelHealth,
  type PublicHealthCheckResult,
} from "@yt-monitor/collector-youtube-public";
import { resolveChannelWithYtdlp, YtdlpError } from "@yt-monitor/collector-ytdlp";
import {
  fetchYoutubeRss,
  parseYoutubeRss,
  RssFetchError,
  RssParseError,
} from "@yt-monitor/collector-youtube-rss";
import type { ChannelRecord } from "@yt-monitor/db";

import type { HealthSignalResult } from "./channel-health.job.js";

export interface ChannelHealthProviderOptions {
  env: { PLAYWRIGHT_EXECUTABLE_PATH: string | undefined };
}

function ytdlpStatus(error: YtdlpError): HealthSignalResult {
  switch (error.code) {
    case "YTDLP_NOT_FOUND":
      return { status: "YTDLP_NOT_FOUND" };
    case "YTDLP_TIMEOUT":
      return { status: "TIMEOUT" };
    case "YTDLP_NETWORK":
    case "YTDLP_BLOCKED":
      return { status: "NETWORK_ERROR" };
    default:
      return { status: "YTDLP_ERROR" };
  }
}

export function createChannelHealthProviders(options: ChannelHealthProviderOptions): {
  publicCheck: (channel: ChannelRecord) => Promise<PublicHealthCheckResult>;
  ytdlpCheck: (channel: ChannelRecord) => Promise<HealthSignalResult>;
  rssCheck: (channel: ChannelRecord) => Promise<HealthSignalResult>;
} {
  return {
    publicCheck: (channel) =>
      checkPublicChannelHealth(
        channel.canonicalUrl,
        options.env.PLAYWRIGHT_EXECUTABLE_PATH
          ? { executablePath: options.env.PLAYWRIGHT_EXECUTABLE_PATH }
          : {},
      ),
    ytdlpCheck: async (channel) => {
      try {
        const resolved = await resolveChannelWithYtdlp(channel.canonicalUrl);
        return resolved?.youtubeChannelId === channel.youtubeChannelId
          ? { status: "YTDLP_OK" }
          : { status: "YTDLP_NOT_FOUND" };
      } catch (error) {
        return ytdlpStatus(error instanceof YtdlpError ? error : new YtdlpError("YTDLP_FAILED"));
      }
    },
    rssCheck: async (channel) => {
      try {
        const feed = parseYoutubeRss(await fetchYoutubeRss(channel.youtubeChannelId));
        return feed.channelId === channel.youtubeChannelId
          ? { status: "RSS_OK" }
          : { status: "RSS_MISSING" };
      } catch (error) {
        if (error instanceof RssParseError) return { status: "RSS_MISSING" };
        if (error instanceof RssFetchError) return { status: "NETWORK_ERROR" };
        return { status: "NETWORK_ERROR" };
      }
    },
  };
}
