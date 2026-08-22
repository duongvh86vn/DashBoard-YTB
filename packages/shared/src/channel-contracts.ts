import { z } from "zod";

export const ChannelAvailabilitySchema = z.enum([
  "ACTIVE",
  "DELETED_OR_TERMINATED",
  "NOT_FOUND",
  "TEMPORARILY_UNAVAILABLE",
  "CHECK_FAILED",
  "UNKNOWN",
  "ARCHIVED",
]);

export const ChannelActivitySchema = z.enum([
  "ACTIVE_RECENT",
  "DORMANT",
  "NO_UPLOAD_HISTORY",
  "UNKNOWN",
]);

export const ChannelSnapshotSourceSchema = z.enum([
  "YOUTUBE_PUBLIC_PAGE",
  "YTDLP",
  "YOUTUBE_RSS",
  "OPTIONAL_PROVIDER",
  "DERIVED",
]);

export const CoverageStatusSchema = z.enum(["COMPLETE", "PARTIAL"]);

export const SyncRunJobTypeSchema = z.enum([
  "CHANNEL_RESOLVE",
  "CHANNEL_CURRENT_STATS",
  "CHANNEL_DAILY_FINALIZE",
  "CHANNEL_HEALTH",
  "RSS_DISCOVERY",
  "YTDLP_RECONCILE",
  "VIDEO_SNAPSHOT_HOT",
  "VIDEO_SNAPSHOT_WARM",
  "BREAKOUT_RECALC",
  "DAILY_AI_REPORT",
  "WEEKLY_AI_REPORT",
  "FULL_RECONCILE",
]);

export const SyncRunStatusSchema = z.enum(["QUEUED", "RUNNING", "SUCCESS", "PARTIAL", "FAILED"]);

export const CanonicalChannelIdSchema = z.string().regex(/^UC[A-Za-z0-9_-]{22}$/u);

export interface ResolvedChannel {
  youtubeChannelId: string;
  canonicalUrl: string;
  handle: string | null;
  title: string | null;
  description: string | null;
  thumbnail: string | null;
}

export interface CanonicalChannel {
  id: string;
  youtubeChannelId: string;
  canonicalUrl: string;
  handle: string | null;
  title: string | null;
}

export interface ChannelCurrentStats {
  subscriberCount: bigint | null;
  videoCount: bigint | null;
  lifetimeViewCount: bigint | null;
  lastUploadAt: Date | null;
  title: string | null;
  handle: string | null;
  thumbnail: string | null;
  source: z.infer<typeof ChannelSnapshotSourceSchema>;
  sourceDetails: Record<string, { source: string; capturedAt: string }> | null;
}

export interface ProviderVideo {
  videoId: string;
  channelId: string;
  title: string | null;
  publishedAt: Date | null;
  description: string | null;
  durationSeconds: number | null;
  thumbnail: string | null;
  availability: string | null;
  liveStatus: string | null;
}

export interface ProviderVideoStats {
  videoId: string;
  viewCount: bigint | null;
  likeCount: bigint | null;
  commentCount: bigint | null;
  capturedAt: Date;
}

export interface PublicChannelProvider {
  resolveChannel(input: string): Promise<ResolvedChannel | null>;
  getChannelCurrentStats(channel: CanonicalChannel): Promise<ChannelCurrentStats | null>;
  listRecentVideos(channel: CanonicalChannel): Promise<ProviderVideo[]>;
  getVideoStats(videoIds: string[]): Promise<ProviderVideoStats[]>;
}

export type ChannelAvailability = z.infer<typeof ChannelAvailabilitySchema>;
export type ChannelActivity = z.infer<typeof ChannelActivitySchema>;
export type ChannelSnapshotSource = z.infer<typeof ChannelSnapshotSourceSchema>;
export type CoverageStatus = z.infer<typeof CoverageStatusSchema>;
export type SyncRunJobType = z.infer<typeof SyncRunJobTypeSchema>;
export type SyncRunStatus = z.infer<typeof SyncRunStatusSchema>;
