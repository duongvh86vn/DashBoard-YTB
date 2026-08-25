import {
  CanonicalChannelIdSchema,
  type CanonicalChannel,
  type ChannelCurrentStats,
  type ProviderVideo,
  type ProviderVideoStats,
  type PublicChannelProvider,
  type ResolvedChannel,
} from "@yt-monitor/shared";

const CHANNEL_ID_PATTERN = /(?:channel_id["'=:\s]+|\/channel\/)(UC[A-Za-z0-9_-]{22})/u;
const TITLE_PATTERN = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/iu;

export interface PublicPageFetchOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function parsePublicChannelHtml(
  html: string,
  canonicalUrl: string,
  handle: string | null,
): ResolvedChannel | null {
  const channelId = CHANNEL_ID_PATTERN.exec(html)?.[1];
  if (!channelId || !CanonicalChannelIdSchema.safeParse(channelId).success) return null;
  const title = TITLE_PATTERN.exec(html)?.[1]?.trim() || null;
  return {
    youtubeChannelId: channelId,
    canonicalUrl: `https://www.youtube.com/channel/${channelId}`,
    handle,
    title,
    description: null,
    thumbnail: null,
  };
}

export async function fetchPublicPage(
  url: string,
  options: PublicPageFetchOptions,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export class YoutubePublicPageProvider implements PublicChannelProvider {
  constructor(private readonly options: PublicPageFetchOptions = {}) {}

  async resolveChannel(input: string): Promise<ResolvedChannel | null> {
    const normalized = input.trim();
    const url = CanonicalChannelIdSchema.safeParse(normalized).success
      ? `https://www.youtube.com/channel/${normalized}`
      : normalized.startsWith("http")
        ? normalized
        : `https://www.youtube.com/${normalized.replace(/^\//u, "")}`;
    const handleMatch = /\/@([A-Za-z0-9._-]{3,30})(?:[/?#]|$)/u.exec(url);
    return parsePublicChannelHtml(
      (await fetchPublicPage(url, this.options)) ?? "",
      url,
      handleMatch ? `@${handleMatch[1]}` : null,
    );
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
