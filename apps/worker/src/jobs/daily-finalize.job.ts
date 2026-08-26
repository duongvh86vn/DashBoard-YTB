import {
  deriveCoverageStatus,
  deriveMetricDeltas,
  previousCalendarDate,
  type NullableChannelMetrics,
} from "@yt-monitor/shared";
import type { ChannelUnitOfWork, ChannelRecord, ChannelSnapshotRecord } from "@yt-monitor/db";

export interface DailyFinalizeJobDependencies {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  timeZone: string;
  currentDate: () => string;
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function metrics(channel: ChannelRecord): NullableChannelMetrics {
  return {
    subscriberCount: channel.subscriberCount,
    videoCount: channel.videoCount,
    lifetimeViewCount: channel.lifetimeViewCount,
  };
}

type CounterKey = "subscriberCount" | "videoCount" | "lifetimeViewCount";
type RawPublicPrecision =
  "EXACT_AS_PUBLISHED" | "ROUNDED_3_SIGNIFICANT_DIGITS" | "ROUNDED_PUBLIC_DISPLAY";

function snapshotMatchesCurrent(channel: ChannelRecord, snapshot: ChannelSnapshotRecord | null) {
  return (
    snapshot !== null &&
    channel.lastChannelScanAt !== null &&
    snapshot.capturedAt.getTime() === channel.lastChannelScanAt.getTime() &&
    snapshot.subscriberCount === channel.subscriberCount &&
    snapshot.videoCount === channel.videoCount &&
    snapshot.lifetimeViewCount === channel.lifetimeViewCount
  );
}

function snapshotPrecision(
  snapshot: ChannelSnapshotRecord | null,
  key: CounterKey,
  fallback: RawPublicPrecision,
): RawPublicPrecision {
  const details = snapshot?.sourceDetails;
  if (typeof details === "object" && details !== null && !Array.isArray(details)) {
    const candidate = (details as Record<string, unknown>)[key];
    if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) {
      const precision = (candidate as Record<string, unknown>).precision;
      if (
        precision === "EXACT_AS_PUBLISHED" ||
        precision === "ROUNDED_3_SIGNIFICANT_DIGITS" ||
        precision === "ROUNDED_PUBLIC_DISPLAY"
      ) {
        return precision;
      }
    }
  }
  return fallback;
}

export class DailyFinalizeJob {
  constructor(private readonly dependencies: DailyFinalizeJobDependencies) {}

  async needsFinalization(channelId: string): Promise<boolean> {
    const currentDate = dateValue(this.dependencies.currentDate());
    const existing = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.dailyStats.findByChannelAndDate(channelId, currentDate),
    );
    // A PARTIAL row is still the canonical result for that boundary. Never
    // overwrite it silently after a worker restart.
    return existing === null;
  }

  async run(channel: ChannelRecord, input: { freshCollectionSucceeded: boolean }): Promise<void> {
    const date = this.dependencies.currentDate();
    const currentDate = dateValue(date);
    const current: NullableChannelMetrics = input.freshCollectionSucceeded
      ? metrics(channel)
      : { subscriberCount: null, videoCount: null, lifetimeViewCount: null };
    await this.dependencies.unitOfWork.transaction(async (repositories) => {
      // A restart after the 00:10 boundary may run the catch-up path again.
      // Preserve the first canonical row for the date instead of replacing it
      // with a later snapshot from the same day.
      const existing = await repositories.dailyStats.findByChannelAndDate(channel.id, currentDate);
      if (existing !== null) return;
      const latestSnapshot = input.freshCollectionSucceeded
        ? await repositories.channels.latestSnapshot(channel.id)
        : null;
      const precisionSnapshot = snapshotMatchesCurrent(channel, latestSnapshot)
        ? latestSnapshot
        : null;
      const capturedAt = channel.lastChannelScanAt?.toISOString() ?? null;
      const sourceSummary = input.freshCollectionSucceeded
        ? {
            subscriberCount: {
              source: "CHANNEL_CURRENT",
              capturedAt,
              precision: snapshotPrecision(
                precisionSnapshot,
                "subscriberCount",
                "ROUNDED_3_SIGNIFICANT_DIGITS",
              ),
            },
            videoCount: {
              source: "CHANNEL_CURRENT",
              capturedAt,
              precision: snapshotPrecision(
                precisionSnapshot,
                "videoCount",
                "ROUNDED_PUBLIC_DISPLAY",
              ),
            },
            lifetimeViewCount: {
              source: "CHANNEL_CURRENT",
              capturedAt,
              precision: snapshotPrecision(
                precisionSnapshot,
                "lifetimeViewCount",
                "ROUNDED_PUBLIC_DISPLAY",
              ),
            },
          }
        : {
            subscriberCount: { source: "MISSING_FRESH_COLLECTION", capturedAt: null },
            videoCount: { source: "MISSING_FRESH_COLLECTION", capturedAt: null },
            lifetimeViewCount: { source: "MISSING_FRESH_COLLECTION", capturedAt: null },
          };
      const previous = await repositories.dailyStats.findByChannelAndDate(
        channel.id,
        dateValue(previousCalendarDate(date)),
      );
      const deltas = deriveMetricDeltas(current, previous);
      await repositories.dailyStats.upsert({
        channelId: channel.id,
        date: currentDate,
        ...current,
        ...deltas,
        coverageStatus: deriveCoverageStatus(current),
        sourceSummary,
      });
    });
  }
}
