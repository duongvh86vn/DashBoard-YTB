import type { VideoMonitorTier } from "@yt-monitor/shared";

export const SNAPSHOT_BUCKET_MS = 60 * 60 * 1000;

export function snapshotBucket(capturedAt: Date): Date {
  return new Date(Math.floor(capturedAt.getTime() / SNAPSHOT_BUCKET_MS) * SNAPSHOT_BUCKET_MS);
}

export function snapshotIntervalMs(tier: VideoMonitorTier): number | null {
  switch (tier) {
    case "HOT":
      return 60 * 60 * 1000;
    case "WARM":
      return 3 * 60 * 60 * 1000;
    case "OLD_HOT":
    case "PINNED":
      return 6 * 60 * 60 * 1000;
    case "ARCHIVED":
      return null;
  }
}

export function shouldCaptureSnapshot(
  tier: VideoMonitorTier,
  now: Date,
  lastCapturedAt: Date | null,
): boolean {
  const interval = snapshotIntervalMs(tier);
  if (interval === null) return false;
  if (lastCapturedAt === null) return true;
  return now.getTime() - lastCapturedAt.getTime() >= interval;
}
