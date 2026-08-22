import {
  CanonicalChannelIdSchema,
  type ProviderVideo,
  type ResolvedChannel,
} from "@yt-monitor/shared";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const HANDLE_PATTERN = /^@[A-Za-z0-9._-]{3,30}$/u;

export type NormalizedChannelInput =
  | { kind: "channel-id"; channelId: string; canonicalUrl: string }
  | { kind: "handle"; handle: string; canonicalUrl: string };

export class ChannelInputError extends Error {
  readonly code = "CHANNEL_INPUT_INVALID" as const;

  constructor() {
    super("Channel input is invalid");
    this.name = "ChannelInputError";
  }
}

function channelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

function handleUrl(handle: string): string {
  return `https://www.youtube.com/${handle}`;
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/u, "");
}

export function normalizeChannelInput(input: string): NormalizedChannelInput {
  const value = input.trim();
  if (CanonicalChannelIdSchema.safeParse(value).success) {
    return { kind: "channel-id", channelId: value, canonicalUrl: channelUrl(value) };
  }
  if (HANDLE_PATTERN.test(value)) {
    return { kind: "handle", handle: value, canonicalUrl: handleUrl(value) };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ChannelInputError();
  }
  if (!/^https?:$/u.test(url.protocol) || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ChannelInputError();
  }
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new ChannelInputError();
  }

  const path = normalizePath(url.pathname);
  const channelMatch = /^\/channel\/(UC[A-Za-z0-9_-]{22})$/u.exec(path);
  if (channelMatch) {
    const channelId = channelMatch[1];
    if (!channelId) throw new ChannelInputError();
    return { kind: "channel-id", channelId, canonicalUrl: channelUrl(channelId) };
  }
  const handleMatch = /^\/(@[A-Za-z0-9._-]{3,30})$/u.exec(path);
  if (handleMatch) {
    const handle = handleMatch[1];
    if (!handle) throw new ChannelInputError();
    return { kind: "handle", handle, canonicalUrl: handleUrl(handle) };
  }
  throw new ChannelInputError();
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && /^\d{8}$/u.test(value)) {
    const date = new Date(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`,
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function nullableBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) return BigInt(value);
  return null;
}

export function normalizeResolvedChannel(value: unknown): ResolvedChannel | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const channelId = nullableString(record.channel_id) ?? nullableString(record.uploader_id);
  if (!channelId || !CanonicalChannelIdSchema.safeParse(channelId).success) return null;
  const canonicalUrl = nullableString(record.channel_url) ?? channelUrl(channelId);
  return {
    youtubeChannelId: channelId,
    canonicalUrl,
    handle: nullableString(record.uploader) ?? nullableString(record.channel),
    title: nullableString(record.channel) ?? nullableString(record.uploader),
    description: nullableString(record.description),
    thumbnail: nullableString(record.thumbnail),
  };
}

export function normalizeProviderVideo(
  value: unknown,
  fallbackChannelId: string,
): ProviderVideo | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const videoId = nullableString(record.id) ?? nullableString(record.video_id);
  if (!videoId) return null;
  return {
    videoId,
    channelId: nullableString(record.channel_id) ?? fallbackChannelId,
    title: nullableString(record.title),
    publishedAt: nullableDate(record.timestamp ?? record.upload_date),
    description: nullableString(record.description),
    durationSeconds:
      typeof record.duration === "number" &&
      Number.isFinite(record.duration) &&
      record.duration >= 0
        ? record.duration
        : null,
    thumbnail: nullableString(record.thumbnail),
    availability: nullableString(record.availability),
    liveStatus: nullableString(record.live_status),
  };
}

export function readNullableCount(value: unknown): bigint | null {
  return nullableBigInt(value);
}
