import type { VideoMonitorTier } from "@yt-monitor/shared";

export interface VideoTierInput {
  publishedAt: Date | null;
  now: Date;
  previousTier: VideoMonitorTier | null;
  isPinned: boolean;
  localVph1h: number | null;
  recentlyReactivated?: boolean;
  retentionDays?: number;
  highVphThreshold?: number;
}

export interface VideoTierResult {
  tier: VideoMonitorTier;
  ageDays: number | null;
  candidate: boolean;
}

export function tierVideo(input: VideoTierInput): VideoTierResult {
  if (input.isPinned) return { tier: "PINNED", ageDays: ageDays(input), candidate: true };
  const age = ageDays(input);
  if (age === null || age <= 7) return { tier: "HOT", ageDays: age, candidate: true };
  if (age <= 30) return { tier: "WARM", ageDays: age, candidate: true };
  const retainedHot = input.previousTier === "HOT" || input.previousTier === "OLD_HOT";
  const highVph =
    input.localVph1h !== null && input.localVph1h >= (input.highVphThreshold ?? 1_000);
  if (highVph) {
    return { tier: "HOT", ageDays: age, candidate: true };
  }
  if (retainedHot || input.recentlyReactivated) {
    return { tier: "OLD_HOT", ageDays: age, candidate: true };
  }
  return { tier: "ARCHIVED", ageDays: age, candidate: false };
}

export function shouldRetainVideo(input: {
  publishedAt: Date | null;
  now: Date;
  isPinned: boolean;
  monitorTier: VideoMonitorTier;
  retentionDays?: number;
}): boolean {
  if (input.isPinned || input.publishedAt === null) return true;
  const retentionDays = input.retentionDays ?? 45;
  const ageDays = (input.now.getTime() - input.publishedAt.getTime()) / 86_400_000;
  return ageDays <= retentionDays || input.monitorTier !== "ARCHIVED";
}

function ageDays(input: VideoTierInput): number | null {
  if (input.publishedAt === null) return null;
  return Math.max(0, (input.now.getTime() - input.publishedAt.getTime()) / 86_400_000);
}
