import {
  deriveCoverageStatus,
  deriveMetricDeltas,
  previousCalendarDate,
  type NullableChannelMetrics,
} from "@yt-monitor/shared";
import type { ChannelUnitOfWork, ChannelRecord } from "@yt-monitor/db";

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
    const source = input.freshCollectionSucceeded
      ? {
          source: "CHANNEL_CURRENT",
          capturedAt: channel.lastChannelScanAt?.toISOString() ?? null,
        }
      : { source: "MISSING_FRESH_COLLECTION", capturedAt: null };
    await this.dependencies.unitOfWork.transaction(async (repositories) => {
      // A restart after the 00:10 boundary may run the catch-up path again.
      // Preserve the first canonical row for the date instead of replacing it
      // with a later snapshot from the same day.
      const existing = await repositories.dailyStats.findByChannelAndDate(channel.id, currentDate);
      if (existing !== null) return;
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
        sourceSummary: {
          subscriberCount: source,
          videoCount: source,
          lifetimeViewCount: source,
        },
      });
    });
  }
}
