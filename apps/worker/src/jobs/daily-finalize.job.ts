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

  async run(channel: ChannelRecord): Promise<void> {
    const date = this.dependencies.currentDate();
    const current = metrics(channel);
    await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const previous = await repositories.dailyStats.findByChannelAndDate(
        channel.id,
        dateValue(previousCalendarDate(date)),
      );
      const deltas = deriveMetricDeltas(current, previous);
      await repositories.dailyStats.upsert({
        channelId: channel.id,
        date: dateValue(date),
        ...current,
        ...deltas,
        coverageStatus: deriveCoverageStatus(current),
        sourceSummary: {
          subscriberCount: {
            source: "CHANNEL_CURRENT",
            capturedAt: channel.lastChannelScanAt?.toISOString() ?? null,
          },
          videoCount: {
            source: "CHANNEL_CURRENT",
            capturedAt: channel.lastChannelScanAt?.toISOString() ?? null,
          },
          lifetimeViewCount: {
            source: "CHANNEL_CURRENT",
            capturedAt: channel.lastChannelScanAt?.toISOString() ?? null,
          },
        },
      });
    });
  }
}
