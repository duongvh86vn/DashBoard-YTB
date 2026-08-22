import { SaxesParser, type SaxesTag } from "saxes";

import { CanonicalChannelIdSchema } from "@yt-monitor/shared";

import { RssParseError, type RssFeed, type RssVideoItem } from "./types.js";

const VIDEO_ID_TAGS = new Set(["yt:videoId", "videoId"]);
const CHANNEL_ID_TAGS = new Set(["yt:channelId", "channelId"]);
const TITLE_TAGS = new Set(["title"]);
const PUBLISHED_TAGS = new Set(["published", "updated"]);

interface MutableEntry {
  videoId: string | null;
  channelId: string | null;
  title: string | null;
  publishedAt: Date | null;
  url: string | null;
  depth: number;
}

function textValue(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function tagName(tag: SaxesTag): string {
  return tag.name;
}

function readLink(tag: SaxesTag): string | null {
  const attributes = tag.attributes as Record<string, { value: string } | string>;
  const rel = attributes.rel;
  const href = attributes.href;
  const relValue = typeof rel === "string" ? rel : rel?.value;
  const hrefValue = typeof href === "string" ? href : href?.value;
  return relValue === "alternate" && typeof hrefValue === "string" ? hrefValue : null;
}

export function parseYoutubeRss(xml: string): RssFeed {
  if (xml.trim().length === 0) throw new RssParseError("RSS feed is empty");
  const parser = new SaxesParser({ xmlns: false });
  const stack: string[] = [];
  const entries: MutableEntry[] = [];
  let current: MutableEntry | null = null;
  let currentText = "";
  let rootChannelId: string | null = null;
  let failed: Error | null = null;

  parser.on("opentag", (tag) => {
    stack.push(tagName(tag));
    const name = tagName(tag);
    if (name === "entry" || name === "item") {
      current = {
        videoId: null,
        channelId: null,
        title: null,
        publishedAt: null,
        url: null,
        depth: stack.length,
      };
      currentText = "";
    } else if (current && name === "link") {
      current.url = readLink(tag);
    }
  });
  parser.on("text", (text) => {
    currentText += text;
  });
  parser.on("cdata", (text) => {
    currentText += text;
  });
  parser.on("closetag", (tag) => {
    const name = typeof tag === "string" ? tag : tagName(tag);
    const value = textValue(currentText);
    if (current) {
      if (VIDEO_ID_TAGS.has(name)) current.videoId = value || null;
      else if (CHANNEL_ID_TAGS.has(name)) current.channelId = value || null;
      else if (TITLE_TAGS.has(name)) current.title = value || null;
      else if (PUBLISHED_TAGS.has(name)) current.publishedAt = parseDate(value);
      else if (name === "entry" || name === "item") {
        entries.push(current);
        current = null;
      }
    } else if (CHANNEL_ID_TAGS.has(name)) {
      rootChannelId = value || null;
    }
    currentText = "";
    stack.pop();
  });
  parser.on("error", (error) => {
    failed = error;
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    failed = error instanceof Error ? error : new Error("RSS parser failed");
  }
  if (failed) throw new RssParseError(failed.message);

  const validEntries = entries.flatMap<RssVideoItem>((entry) => {
    const channelId = entry.channelId ?? rootChannelId;
    if (
      !entry.videoId ||
      !channelId ||
      !CanonicalChannelIdSchema.safeParse(channelId).success ||
      !entry.title ||
      !entry.publishedAt
    ) {
      return [];
    }
    return [
      {
        videoId: entry.videoId,
        channelId,
        title: entry.title,
        publishedAt: entry.publishedAt,
        url: entry.url ?? `https://www.youtube.com/watch?v=${encodeURIComponent(entry.videoId)}`,
      },
    ];
  });
  const channelId = rootChannelId ?? validEntries[0]?.channelId;
  if (!channelId || !CanonicalChannelIdSchema.safeParse(channelId).success) {
    throw new RssParseError("RSS feed did not contain a canonical channel id");
  }
  const deduped = new Map<string, RssVideoItem>();
  for (const item of validEntries) {
    if (!deduped.has(item.videoId)) deduped.set(item.videoId, item);
  }
  return { channelId, items: [...deduped.values()] };
}
