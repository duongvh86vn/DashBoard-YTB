import { CanonicalChannelIdSchema } from "@yt-monitor/shared";

import { RssFetchError } from "./types.js";

export const DEFAULT_RSS_TIMEOUT_MS = 10_000;

export function youtubeRssUrl(channelId: string): string {
  if (!CanonicalChannelIdSchema.safeParse(channelId).success)
    throw new TypeError("Invalid YouTube channel id");
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

export interface FetchRssOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchYoutubeRss(
  channelId: string,
  options: FetchRssOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RSS_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(youtubeRssUrl(channelId), {
      headers: { Accept: "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8" },
      signal: controller.signal,
    });
    if (!response.ok) throw new RssFetchError(`RSS feed returned HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (error instanceof RssFetchError) throw error;
    throw new RssFetchError();
  } finally {
    clearTimeout(timer);
  }
}
