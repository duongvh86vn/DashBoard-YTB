import { z } from "zod";

export const ChannelHealthSignalStatusSchema = z.enum([
  "PUBLIC_PAGE_RENDERED",
  "PUBLIC_PAGE_NOT_FOUND",
  "PUBLIC_PAGE_TERMINATED",
  "PUBLIC_PAGE_BLOCKED",
  "YTDLP_OK",
  "YTDLP_NOT_FOUND",
  "YTDLP_ERROR",
  "RSS_OK",
  "RSS_MISSING",
  "NETWORK_ERROR",
  "TIMEOUT",
]);

export type ChannelHealthSignalStatus = z.infer<typeof ChannelHealthSignalStatusSchema>;

export const ChannelHealthEvidenceCodeSchema = z.enum([
  "ACTIVE_PUBLIC_PAGE",
  "ACTIVE_YTDLP",
  "ACTIVE_RSS",
  "NOT_FOUND_PUBLIC_PAGE",
  "TERMINATED_PUBLIC_PAGE",
  "NOT_FOUND_YTDLP",
  "BLOCKED_PUBLIC_PAGE",
  "NETWORK_ERROR",
  "TIMEOUT",
  "RSS_MISSING",
  "COLLECTOR_ERROR",
  "PROVIDER_INCIDENT",
  "ARCHIVED",
  "UNKNOWN",
]);

export type ChannelHealthEvidenceCode = z.infer<typeof ChannelHealthEvidenceCodeSchema>;

export interface ChannelHealthSignals {
  publicPage: ChannelHealthSignalStatus;
  ytdlp: ChannelHealthSignalStatus;
  rss: ChannelHealthSignalStatus;
}

export interface SanitizedHealthEvidence {
  evidenceCode: ChannelHealthEvidenceCode;
  evidenceTextSafe: string | null;
  httpStatus: number | null;
  durationMs: number;
}

export const HEALTH_RETRY_DELAY_MS = 30 * 60 * 1000;

export function isPositiveSignal(status: ChannelHealthSignalStatus): boolean {
  return status === "PUBLIC_PAGE_RENDERED" || status === "YTDLP_OK" || status === "RSS_OK";
}

export function isStrongFailureSignal(status: ChannelHealthSignalStatus): boolean {
  return (
    status === "PUBLIC_PAGE_NOT_FOUND" ||
    status === "PUBLIC_PAGE_TERMINATED" ||
    status === "YTDLP_NOT_FOUND"
  );
}

export function isTransientFailureSignal(status: ChannelHealthSignalStatus): boolean {
  return (
    status === "PUBLIC_PAGE_BLOCKED" ||
    status === "YTDLP_ERROR" ||
    status === "NETWORK_ERROR" ||
    status === "TIMEOUT"
  );
}

export function strongFailureCount(signals: ChannelHealthSignals): number {
  return [signals.publicPage, signals.ytdlp, signals.rss].filter(isStrongFailureSignal).length;
}

export function hasTransientFailure(signals: ChannelHealthSignals): boolean {
  return [signals.publicPage, signals.ytdlp, signals.rss].some(isTransientFailureSignal);
}
