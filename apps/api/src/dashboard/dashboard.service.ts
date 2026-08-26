import type {
  ChannelDailyStatRecord,
  ChannelRecord,
  ChannelUnitOfWork,
  PublishedVideoRecord,
} from "@yt-monitor/db";
import {
  DashboardTrendResponseSchema,
  localCalendarDate,
  previousCalendarDate,
  type DashboardTrendPoint,
  type DashboardTrendResponse,
} from "@yt-monitor/shared";

import type { DashboardApplicationPort } from "./dashboard-application.port.js";
import type {
  ChannelAccessResolverPort,
  ChannelAccessSubject,
} from "../channel-groups/channel-groups-application.port.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

interface DashboardServiceDependencies {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  access: ChannelAccessResolverPort;
  timeZone: string;
  now?: () => Date;
}

type MetricName = "subscriberDelta" | "viewDelta";
type CurrentMetricName = "subscriberCount" | "videoCount" | "lifetimeViewCount";

function observedMetric(values: Array<bigint | null>) {
  const known = values.filter((value): value is bigint => value !== null);
  const coveredChannels = known.length;
  const totalChannels = values.length;
  if (coveredChannels === 0) {
    return { value: null, coveredChannels, totalChannels, status: "UNAVAILABLE" as const };
  }
  return {
    value: known.reduce<bigint>((sum, value) => sum + value, 0n).toString(),
    coveredChannels,
    totalChannels,
    status: coveredChannels === totalChannels ? ("COMPLETE" as const) : ("PARTIAL" as const),
  };
}

function shiftCalendarDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function calendarDateRange(startDate: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) => shiftCalendarDate(startDate, index));
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function sumComplete(values: Array<bigint | null>): string | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n).toString();
}

function currentMetric(channel: ChannelRecord, metric: MetricName): bigint | null {
  return metric === "viewDelta" ? channel.lifetimeViewCount : channel.subscriberCount;
}

function baselineMetric(
  stat: ChannelDailyStatRecord | undefined,
  metric: MetricName,
): bigint | null {
  if (!stat) return null;
  return metric === "viewDelta" ? stat.lifetimeViewCount : stat.subscriberCount;
}

function storedDelta(stat: ChannelDailyStatRecord | undefined, metric: MetricName): bigint | null {
  if (!stat) return null;
  return metric === "viewDelta" ? stat.viewDelta : stat.subscriberDelta;
}

function totalDeltaValues(
  channels: readonly ChannelRecord[],
  baselineByChannel: ReadonlyMap<string, ChannelDailyStatRecord>,
  metric: MetricName,
  endDate: string,
  timeZone: string,
): Array<bigint | null> {
  return channels.map((channel) => {
    if (
      channel.lastChannelScanAt === null ||
      localCalendarDate(channel.lastChannelScanAt, timeZone) !== endDate
    ) {
      return null;
    }
    const current = currentMetric(channel, metric);
    const baseline = baselineMetric(baselineByChannel.get(channel.id), metric);
    return current !== null && baseline !== null ? current - baseline : null;
  });
}

function hasCompleteCurrentSnapshot(
  channel: ChannelRecord,
  date: string,
  timeZone: string,
): boolean {
  return (
    channel.lastChannelScanAt !== null &&
    localCalendarDate(channel.lastChannelScanAt, timeZone) === date &&
    channel.subscriberCount !== null &&
    channel.videoCount !== null &&
    channel.lifetimeViewCount !== null
  );
}

function hasCurrentMetric(
  channel: ChannelRecord,
  date: string,
  timeZone: string,
  metric: CurrentMetricName,
): boolean {
  return (
    channel.lastChannelScanAt !== null &&
    localCalendarDate(channel.lastChannelScanAt, timeZone) === date &&
    channel[metric] !== null
  );
}

function isCompleteDay(
  date: string,
  endDate: string,
  timeZone: string,
  channels: readonly ChannelRecord[],
  statsByDateAndChannel: ReadonlyMap<string, ReadonlyMap<string, ChannelDailyStatRecord>>,
): boolean {
  if (channels.length === 0) return false;
  if (date === endDate) {
    return channels.every((channel) => hasCompleteCurrentSnapshot(channel, date, timeZone));
  }
  const rows = statsByDateAndChannel.get(date);
  return (
    rows !== undefined &&
    rows.size === channels.length &&
    channels.every((channel) => rows.get(channel.id)?.coverageStatus === "COMPLETE")
  );
}

function dailyDeltaValues(
  date: string,
  endDate: string,
  timeZone: string,
  channels: readonly ChannelRecord[],
  statsByDateAndChannel: ReadonlyMap<string, ReadonlyMap<string, ChannelDailyStatRecord>>,
  metric: MetricName,
): Array<bigint | null> {
  const rows = statsByDateAndChannel.get(date);
  const previousRows = statsByDateAndChannel.get(previousCalendarDate(date));
  return channels.map((channel) => {
    const scannedToday =
      date === endDate &&
      channel.lastChannelScanAt !== null &&
      localCalendarDate(channel.lastChannelScanAt, timeZone) === date;
    if (scannedToday) {
      const current = currentMetric(channel, metric);
      const previous = baselineMetric(previousRows?.get(channel.id), metric);
      return current !== null && previous !== null ? current - previous : null;
    }
    return storedDelta(rows?.get(channel.id), metric);
  });
}

function hasSnapshotForDate(
  date: string,
  endDate: string,
  timeZone: string,
  channels: readonly ChannelRecord[],
  statsByDateAndChannel: ReadonlyMap<string, ReadonlyMap<string, ChannelDailyStatRecord>>,
): boolean {
  if ((statsByDateAndChannel.get(date)?.size ?? 0) > 0) return true;
  return (
    date === endDate &&
    channels.some(
      (channel) =>
        channel.lastChannelScanAt !== null &&
        localCalendarDate(channel.lastChannelScanAt, timeZone) === date,
    )
  );
}

function videoCountsByDate(
  videos: readonly PublishedVideoRecord[],
  channelIds: ReadonlySet<string>,
  timeZone: string,
  startDate: string,
  endDate: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const video of videos) {
    if (video.publishedAt === null || !channelIds.has(video.channelId)) continue;
    const date = localCalendarDate(video.publishedAt, timeZone);
    if (date < startDate || date > endDate) continue;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return counts;
}

export class DashboardService implements DashboardApplicationPort {
  constructor(private readonly dependencies: DashboardServiceDependencies) {}

  async trends(input: {
    days: number;
    subject: ChannelAccessSubject;
  }): Promise<DashboardTrendResponse> {
    const now = (this.dependencies.now ?? (() => new Date()))();
    const endDate = localCalendarDate(now, this.dependencies.timeZone);
    const startDate = shiftCalendarDate(endDate, -(input.days - 1));
    const baselineDate = previousCalendarDate(startDate);
    const databaseStart = new Date(`${baselineDate}T00:00:00.000Z`);
    const databaseEnd = new Date(`${endDate}T00:00:00.000Z`);
    const publishedStart = new Date(databaseStart.getTime() - DAY_MS);
    const publishedEndExclusive = new Date(databaseEnd.getTime() + 2 * DAY_MS);

    const visibleChannelIds = await this.dependencies.access.resolveVisibleChannelIds(
      input.subject,
    );
    const { channels, stats, videos } = await this.dependencies.unitOfWork.transaction(
      async (repositories) => {
        const channels = await repositories.channels.listEnabled(
          visibleChannelIds === null ? undefined : visibleChannelIds,
        );
        const channelIds = channels.map((channel) => channel.id);
        const [stats, videos] = await Promise.all([
          repositories.dailyStats.listByChannelsAndDateRange(
            channelIds,
            databaseStart,
            databaseEnd,
          ),
          repositories.videos.listPublishedBetween(
            publishedStart,
            publishedEndExclusive,
            channelIds,
          ),
        ]);
        return { channels, stats, videos };
      },
    );

    const statsByDateAndChannel = new Map<string, Map<string, ChannelDailyStatRecord>>();
    for (const stat of stats) {
      const date = dateKey(stat.date);
      const byChannel = statsByDateAndChannel.get(date) ?? new Map();
      byChannel.set(stat.channelId, stat);
      statsByDateAndChannel.set(date, byChannel);
    }
    const baselineByChannel = statsByDateAndChannel.get(baselineDate) ?? new Map();
    const channelIds = new Set(channels.map((channel) => channel.id));
    const publishedByDate = videoCountsByDate(
      videos,
      channelIds,
      this.dependencies.timeZone,
      startDate,
      endDate,
    );
    const series: DashboardTrendPoint[] = calendarDateRange(startDate, input.days).map((date) => {
      const viewDeltas = dailyDeltaValues(
        date,
        endDate,
        this.dependencies.timeZone,
        channels,
        statsByDateAndChannel,
        "viewDelta",
      );
      const subscriberDeltas = dailyDeltaValues(
        date,
        endDate,
        this.dependencies.timeZone,
        channels,
        statsByDateAndChannel,
        "subscriberDelta",
      );
      return {
        date,
        viewDelta: sumComplete(viewDeltas),
        subscriberDelta: sumComplete(subscriberDeltas),
        observed: {
          viewDelta: observedMetric(viewDeltas),
          subscriberDelta: observedMetric(subscriberDeltas),
        },
        publishedVideos: publishedByDate.get(date) ?? 0,
        hasSnapshot: hasSnapshotForDate(
          date,
          endDate,
          this.dependencies.timeZone,
          channels,
          statsByDateAndChannel,
        ),
      };
    });
    const completeDays = series.filter((point) =>
      isCompleteDay(
        point.date,
        endDate,
        this.dependencies.timeZone,
        channels,
        statsByDateAndChannel,
      ),
    ).length;
    const partialDays = series.filter(
      (point) =>
        point.hasSnapshot &&
        !isCompleteDay(
          point.date,
          endDate,
          this.dependencies.timeZone,
          channels,
          statsByDateAndChannel,
        ),
    ).length;

    const totalViewDeltas = totalDeltaValues(
      channels,
      baselineByChannel,
      "viewDelta",
      endDate,
      this.dependencies.timeZone,
    );
    const totalSubscriberDeltas = totalDeltaValues(
      channels,
      baselineByChannel,
      "subscriberDelta",
      endDate,
      this.dependencies.timeZone,
    );

    return DashboardTrendResponseSchema.parse({
      period: {
        startDate,
        endDate,
        days: input.days,
        timeZone: this.dependencies.timeZone,
      },
      totals: {
        viewDelta: sumComplete(totalViewDeltas),
        subscriberDelta: sumComplete(totalSubscriberDeltas),
        publishedVideos: [...publishedByDate.values()].reduce((sum, value) => sum + value, 0),
      },
      observedTotals: {
        viewDelta: observedMetric(totalViewDeltas),
        subscriberDelta: observedMetric(totalSubscriberDeltas),
      },
      coverage: {
        totalChannels: channels.length,
        channelsWithCurrentSnapshot: channels.filter(
          (channel) => channel.lastChannelScanAt !== null,
        ).length,
        channelsScanned: channels.filter(
          (channel) =>
            channel.lastChannelScanAt !== null &&
            localCalendarDate(channel.lastChannelScanAt, this.dependencies.timeZone) === endDate,
        ).length,
        channelsWithCompleteCurrentSnapshot: channels.filter((channel) =>
          hasCompleteCurrentSnapshot(channel, endDate, this.dependencies.timeZone),
        ).length,
        channelsWithCurrentSubscribers: channels.filter((channel) =>
          hasCurrentMetric(channel, endDate, this.dependencies.timeZone, "subscriberCount"),
        ).length,
        channelsWithCurrentLifetimeViews: channels.filter((channel) =>
          hasCurrentMetric(channel, endDate, this.dependencies.timeZone, "lifetimeViewCount"),
        ).length,
        channelsWithCurrentPublicVideos: channels.filter((channel) =>
          hasCurrentMetric(channel, endDate, this.dependencies.timeZone, "videoCount"),
        ).length,
        channelsWithBaseline: channels.filter((channel) => {
          const baseline = baselineByChannel.get(channel.id);
          return (
            baseline !== undefined &&
            baseline.lifetimeViewCount !== null &&
            baseline.subscriberCount !== null
          );
        }).length,
        requestedDays: input.days,
        completeDays,
        partialDays,
        coveragePercent: Math.round((completeDays / input.days) * 1_000) / 10,
      },
      series,
    });
  }
}
