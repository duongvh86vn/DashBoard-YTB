import type { ProviderVideo } from "@yt-monitor/shared";

import { YtdlpError, normalizeYtdlpFailure } from "./errors.js";
import { normalizeProviderVideo, readNullableCount } from "./normalize.js";
import { assertMetadataOnlyArgs } from "./process-runner.js";
import { createYtdlpRunner, type YtdlpRunner } from "./resolve-channel.js";

export const FULL_CATALOG_TIMEOUT_MS = 5 * 60_000;
export const FULL_CATALOG_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export const FULL_CATALOG_ARGS = [
  "--dump-single-json",
  "--skip-download",
  "--no-warnings",
  "--flat-playlist",
] as const;

export interface YtdlpCatalogVideo extends ProviderVideo {
  viewCount: bigint | null;
  likeCount: bigint | null;
  commentCount: bigint | null;
}

export interface YtdlpFullCatalog {
  videos: YtdlpCatalogVideo[];
  sourceEntryCount: number;
  skippedEntryCount: number;
  missingViewCount: number;
}

/**
 * YouTube's uploads playlist is the single public catalog behind a channel's
 * Videos, Shorts, and Live tabs. A tab-specific `/videos` URL omits the latter
 * two categories, while the root channel URL is emitted by yt-dlp as nested
 * tab playlists when flat extraction is enabled.
 */
export function youtubeUploadsPlaylistUrl(channelId: string): string {
  if (!/^UC[A-Za-z0-9_-]{22}$/u.test(channelId)) {
    throw new YtdlpError("YTDLP_FAILED", "A canonical YouTube channel ID is required");
  }
  return `https://www.youtube.com/playlist?list=UU${channelId.slice(2)}`;
}

function parseRoot(stdout: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new YtdlpError("YTDLP_INVALID_JSON", "yt-dlp returned invalid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new YtdlpError("YTDLP_INVALID_JSON", "yt-dlp catalog JSON must be an object");
  }

  return parsed as Record<string, unknown>;
}

export function parseFullCatalogJson(stdout: string, expectedChannelId: string): YtdlpFullCatalog {
  const root = parseRoot(stdout);
  if (!Array.isArray(root.entries)) {
    throw new YtdlpError("YTDLP_INVALID_JSON", "yt-dlp catalog JSON is missing entries");
  }

  const declaredEntryCount =
    typeof root.playlist_count === "number" &&
    Number.isSafeInteger(root.playlist_count) &&
    root.playlist_count >= 0
      ? root.playlist_count
      : null;
  const sourceEntryCount = Math.max(root.entries.length, declaredEntryCount ?? 0);
  const videosById = new Map<string, YtdlpCatalogVideo>();
  // A declared playlist size that disagrees with the emitted entries is
  // positive evidence that the catalog envelope is incomplete/inconsistent.
  let skippedEntryCount =
    declaredEntryCount === null ? 0 : Math.abs(declaredEntryCount - root.entries.length);
  let missingViewCount = 0;

  for (const rawEntry of root.entries) {
    if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) {
      skippedEntryCount += 1;
      continue;
    }

    const entry = rawEntry as Record<string, unknown>;
    const video = normalizeProviderVideo(entry, expectedChannelId);
    if (!video || video.channelId !== expectedChannelId) {
      skippedEntryCount += 1;
      continue;
    }

    const viewCount = readNullableCount(entry.view_count);
    if (viewCount === null) {
      missingViewCount += 1;
    }

    if (!videosById.has(video.videoId)) {
      videosById.set(video.videoId, {
        ...video,
        viewCount,
        likeCount: readNullableCount(entry.like_count),
        commentCount: readNullableCount(entry.comment_count),
      });
    }
  }

  return {
    videos: [...videosById.values()].sort((left, right) =>
      left.videoId.localeCompare(right.videoId),
    ),
    sourceEntryCount,
    skippedEntryCount,
    missingViewCount,
  };
}

export async function listFullCatalogWithYtdlp(
  channelUrl: string,
  expectedChannelId: string,
  runner: YtdlpRunner = createYtdlpRunner({
    timeoutMs: FULL_CATALOG_TIMEOUT_MS,
    maxOutputBytes: FULL_CATALOG_MAX_OUTPUT_BYTES,
  }),
): Promise<YtdlpFullCatalog> {
  const args = [...FULL_CATALOG_ARGS, channelUrl];
  assertMetadataOnlyArgs(args);

  try {
    const result = await runner.run(args);
    return parseFullCatalogJson(result.stdout, expectedChannelId);
  } catch (error) {
    if (error instanceof YtdlpError) {
      throw error;
    }
    throw normalizeYtdlpFailure(error);
  }
}
