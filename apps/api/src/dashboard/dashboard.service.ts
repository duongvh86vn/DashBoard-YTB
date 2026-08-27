import type {
  ChannelDailyStatRecord,
  ChannelMonetizationSettingRecord,
  ChannelRecord,
  ChannelUnitOfWork,
  PublishedVideoRecord,
  VideoCatalogComparisonRecord,
  VideoCatalogScanRecord,
} from "@yt-monitor/db";
import {
  calculateEstimatedRevenueMicros,
  formatRpmMicros,
  formatUsdMicros,
} from "@yt-monitor/analytics";
import {
  DailyVideoLeadersResponseSchema,
  DashboardRevenueResponseSchema,
  DashboardTrendResponseSchema,
  localCalendarDate,
  previousCalendarDate,
  type DailyVideoLeader,
  type DailyVideoLeadersResponse,
  type DashboardRevenueChannel,
  type DashboardRevenuePoint,
  type DashboardRevenueResponse,
  type DashboardTrendPoint,
  type DashboardTrendResponse,
} from "@yt-monitor/shared";

import type { DashboardApplicationPort } from "./dashboard-application.port.js";
import type {
  ChannelAccessSubject,
  ChannelSelection,
  ChannelSelectionResolverPort,
} from "../channel-groups/channel-groups-application.port.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

interface DashboardServiceDependencies {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  access: ChannelSelectionResolverPort;
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

function selectionOf(input: ChannelSelection): ChannelSelection {
  return {
    ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
    ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
  };
}

interface RevenueCoverage {
  totalEstimatedRevenueUsd: string | null;
  observedEstimatedRevenueUsd: string | null;
  status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  covered: number;
}

function revenueCoverage(values: readonly (bigint | null)[]): RevenueCoverage {
  const known = values.filter((value): value is bigint => value !== null);
  if (known.length === 0) {
    return {
      totalEstimatedRevenueUsd: null,
      observedEstimatedRevenueUsd: null,
      status: "UNAVAILABLE",
      covered: 0,
    };
  }
  const observed = formatUsdMicros(known.reduce<bigint>((sum, value) => sum + value, 0n));
  if (known.length !== values.length) {
    return {
      totalEstimatedRevenueUsd: null,
      observedEstimatedRevenueUsd: observed,
      status: "PARTIAL",
      covered: known.length,
    };
  }
  return {
    totalEstimatedRevenueUsd: observed,
    observedEstimatedRevenueUsd: observed,
    status: "COMPLETE",
    covered: known.length,
  };
}

function settingsByChannel(
  rows: readonly ChannelMonetizationSettingRecord[],
): Map<string, ChannelMonetizationSettingRecord[]> {
  const result = new Map<string, ChannelMonetizationSettingRecord[]>();
  for (const row of rows) {
    const channelRows = result.get(row.channelId) ?? [];
    channelRows.push(row);
    result.set(row.channelId, channelRows);
  }
  for (const channelRows of result.values()) {
    channelRows.sort((left, right) => {
      const dateOrder = left.effectiveDate.getTime() - right.effectiveDate.getTime();
      if (dateOrder !== 0) return dateOrder;
      const updateOrder = left.updatedAt.getTime() - right.updatedAt.getTime();
      return updateOrder !== 0 ? updateOrder : left.id.localeCompare(right.id);
    });
  }
  return result;
}

function effectiveSetting(
  rows: readonly ChannelMonetizationSettingRecord[],
  date: string,
): ChannelMonetizationSettingRecord | null {
  let latest: ChannelMonetizationSettingRecord | null = null;
  for (const row of rows) {
    if (dateKey(row.effectiveDate) > date) break;
    latest = row;
  }
  return latest;
}

function revenueForDay(
  viewDelta: bigint | null,
  setting: ChannelMonetizationSettingRecord | null,
): bigint | null {
  if (setting === null) return null;
  if (!setting.isMonetized) return 0n;
  if (viewDelta === null || setting.rpmMicros === null) return null;
  return calculateEstimatedRevenueMicros(viewDelta, setting.rpmMicros);
}

function scanKey(channelId: string, date: string): string {
  return `${channelId}:${date}`;
}

function snapshotAtBucket(video: VideoCatalogComparisonRecord, bucket: Date) {
  const bucketTime = bucket.getTime();
  return video.snapshots.find(
    (snapshot) =>
      snapshot.source === "YTDLP_CATALOG" && snapshot.snapshotBucket.getTime() === bucketTime,
  );
}

function isCompleteCatalogBucket(
  scan: VideoCatalogScanRecord,
  videos: readonly VideoCatalogComparisonRecord[],
): boolean {
  const knownViews = videos.filter((video) => {
    const snapshot = snapshotAtBucket(video, scan.snapshotBucket);
    return snapshot !== undefined && snapshot.views !== null;
  }).length;
  return (
    scan.coverageStatus === "COMPLETE" &&
    scan.videosWithViews === scan.totalVideos &&
    knownViews === scan.videosWithViews
  );
}

function compareBigIntDescending(left: bigint, right: bigint): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

function contributionPercent(videoDelta: bigint, channelDelta: bigint): number {
  const tenths = (videoDelta * 1_000n + channelDelta / 2n) / channelDelta;
  return Number(tenths) / 10;
}

export class DashboardService implements DashboardApplicationPort {
  constructor(private readonly dependencies: DashboardServiceDependencies) {}

  async trends(
    input: {
      days: number;
      subject: ChannelAccessSubject;
    } & ChannelSelection,
  ): Promise<DashboardTrendResponse> {
    const now = (this.dependencies.now ?? (() => new Date()))();
    const endDate = localCalendarDate(now, this.dependencies.timeZone);
    const startDate = shiftCalendarDate(endDate, -(input.days - 1));
    const baselineDate = previousCalendarDate(startDate);
    const databaseStart = new Date(`${baselineDate}T00:00:00.000Z`);
    const databaseEnd = new Date(`${endDate}T00:00:00.000Z`);
    const publishedStart = new Date(databaseStart.getTime() - DAY_MS);
    const publishedEndExclusive = new Date(databaseEnd.getTime() + 2 * DAY_MS);

    const visibleChannelIds = await this.dependencies.access.resolveSelectedChannelIds(
      input.subject,
      {
        ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
        ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
      },
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

  async revenue(
    input: {
      days: number;
      subject: ChannelAccessSubject;
    } & ChannelSelection,
  ): Promise<DashboardRevenueResponse> {
    const now = (this.dependencies.now ?? (() => new Date()))();
    const endDate = localCalendarDate(now, this.dependencies.timeZone);
    const startDate = shiftCalendarDate(endDate, -(input.days - 1));
    const dates = calendarDateRange(startDate, input.days);
    const visibleChannelIds = await this.dependencies.access.resolveSelectedChannelIds(
      input.subject,
      selectionOf(input),
    );
    const { channels, stats, monetizationSettings } =
      await this.dependencies.unitOfWork.transaction(async (repositories) => {
        const channels = await repositories.channels.listEnabled(
          visibleChannelIds === null ? undefined : visibleChannelIds,
        );
        const channelIds = channels.map((channel) => channel.id);
        const [stats, monetizationSettings] = await Promise.all([
          repositories.dailyStats.listByChannelsAndDateRange(
            channelIds,
            new Date(`${startDate}T00:00:00.000Z`),
            new Date(`${endDate}T00:00:00.000Z`),
          ),
          repositories.channelMonetization.listEffectiveThroughDate(
            channelIds,
            new Date(`${endDate}T00:00:00.000Z`),
          ),
        ]);
        return { channels, stats, monetizationSettings };
      });

    const statsByDateAndChannel = new Map<string, Map<string, ChannelDailyStatRecord>>();
    for (const stat of stats) {
      const date = dateKey(stat.date);
      const rows = statsByDateAndChannel.get(date) ?? new Map();
      rows.set(stat.channelId, stat);
      statsByDateAndChannel.set(date, rows);
    }
    const settings = settingsByChannel(monetizationSettings);
    const revenueByChannel = new Map<string, Array<bigint | null>>(
      channels.map((channel) => [channel.id, []]),
    );
    const series: DashboardRevenuePoint[] = dates.map((date) => {
      const dailyViews = channels.map((channel) =>
        storedDelta(statsByDateAndChannel.get(date)?.get(channel.id), "viewDelta"),
      );
      const dailyRevenue = channels.map((channel, index) => {
        const viewDelta = dailyViews[index] ?? null;
        const setting = effectiveSetting(settings.get(channel.id) ?? [], date);
        const revenue = revenueForDay(viewDelta, setting);
        revenueByChannel.get(channel.id)?.push(revenue);
        return revenue;
      });
      const coverage = revenueCoverage(dailyRevenue);
      return {
        date,
        totalEstimatedRevenueUsd: coverage.totalEstimatedRevenueUsd,
        observedEstimatedRevenueUsd: coverage.observedEstimatedRevenueUsd,
        status: coverage.status,
        coveredChannels: coverage.covered,
        totalChannels: channels.length,
      };
    });

    const channelResults: DashboardRevenueChannel[] = channels
      .map((channel) => {
        const channelSettings = settings.get(channel.id) ?? [];
        const latest = effectiveSetting(channelSettings, endDate);
        const coverage = revenueCoverage(revenueByChannel.get(channel.id) ?? []);
        const monetizationStatus =
          latest === null ? "UNCONFIGURED" : latest.isMonetized ? "ENABLED" : "DISABLED";
        return {
          channelId: channel.id,
          channelTitle: channel.title,
          monetizationStatus,
          effectiveDate: latest === null ? null : dateKey(latest.effectiveDate),
          rpmUsd:
            latest?.isMonetized === true && latest.rpmMicros !== null
              ? formatRpmMicros(latest.rpmMicros)
              : null,
          lastReviewedAt: latest === null ? null : latest.updatedAt.toISOString(),
          totalEstimatedRevenueUsd: coverage.totalEstimatedRevenueUsd,
          observedEstimatedRevenueUsd: coverage.observedEstimatedRevenueUsd,
          status: coverage.status,
          coveredDays: coverage.covered,
          totalDays: input.days,
        } satisfies DashboardRevenueChannel;
      })
      .sort(
        (left, right) =>
          left.channelTitle.localeCompare(right.channelTitle) ||
          left.channelId.localeCompare(right.channelId),
      );
    const latestSettings = channels.map((channel) =>
      effectiveSetting(settings.get(channel.id) ?? [], endDate),
    );
    const allRevenue = channels.flatMap((channel) => revenueByChannel.get(channel.id) ?? []);
    const metric = revenueCoverage(allRevenue);

    return DashboardRevenueResponseSchema.parse({
      period: {
        startDate,
        endDate,
        days: input.days,
        timeZone: this.dependencies.timeZone,
      },
      currency: "USD",
      method: "PUBLIC_VIEW_DELTA_X_MANUAL_RPM",
      metric: {
        totalEstimatedRevenueUsd: metric.totalEstimatedRevenueUsd,
        observedEstimatedRevenueUsd: metric.observedEstimatedRevenueUsd,
        status: metric.status,
        coveredChannelDays: metric.covered,
        totalChannelDays: channels.length * input.days,
      },
      configuredChannels: latestSettings.filter((setting) => setting !== null).length,
      monetizedChannels: latestSettings.filter((setting) => setting?.isMonetized === true).length,
      totalChannels: channels.length,
      series,
      channels: channelResults,
    });
  }

  async dailyVideoLeaders(
    input: { subject: ChannelAccessSubject } & ChannelSelection,
  ): Promise<DailyVideoLeadersResponse> {
    const now = (this.dependencies.now ?? (() => new Date()))();
    const date = localCalendarDate(now, this.dependencies.timeZone);
    const previousDate = previousCalendarDate(date);
    const visibleChannelIds = await this.dependencies.access.resolveSelectedChannelIds(
      input.subject,
      selectionOf(input),
    );
    const { channels, stats, scans, videos } = await this.dependencies.unitOfWork.transaction(
      async (repositories) => {
        const channels = await repositories.channels.listEnabled(
          visibleChannelIds === null ? undefined : visibleChannelIds,
        );
        const channelIds = channels.map((channel) => channel.id);
        const [stats, scans] = await Promise.all([
          repositories.dailyStats.listByChannelsAndDateRange(
            channelIds,
            new Date(`${previousDate}T00:00:00.000Z`),
            new Date(`${date}T00:00:00.000Z`),
          ),
          repositories.videoCatalogScans.listByChannelsAndDateRange(
            channelIds,
            new Date(`${previousDate}T00:00:00.000Z`),
            new Date(`${date}T00:00:00.000Z`),
          ),
        ]);
        const snapshotBuckets = [
          ...new Map(
            scans.map((scan) => [scan.snapshotBucket.getTime(), scan.snapshotBucket]),
          ).values(),
        ];
        const videos = await repositories.videos.listForCatalogComparison(
          channelIds,
          snapshotBuckets,
        );
        return { channels, stats, scans, videos };
      },
    );

    const currentStats = new Map(
      stats.filter((stat) => dateKey(stat.date) === date).map((stat) => [stat.channelId, stat]),
    );
    const channelGain = new Map<string, bigint | null>();
    for (const channel of channels) {
      // The catalog comparison is a finalized daily interval. Use the matching
      // canonical daily delta as its denominator; the mutable Channel row may
      // already contain a later same-day scan and would make attribution drift.
      channelGain.set(channel.id, currentStats.get(channel.id)?.viewDelta ?? null);
    }

    const scansByChannelAndDate = new Map<string, VideoCatalogScanRecord>();
    for (const scan of scans)
      scansByChannelAndDate.set(scanKey(scan.channelId, dateKey(scan.date)), scan);
    const pairs = new Map<
      string,
      { previous: VideoCatalogScanRecord; current: VideoCatalogScanRecord }
    >();
    for (const channel of channels) {
      const previous = scansByChannelAndDate.get(scanKey(channel.id, previousDate));
      const current = scansByChannelAndDate.get(scanKey(channel.id, date));
      if (previous && current) pairs.set(channel.id, { previous, current });
    }
    const videosByChannel = new Map<string, VideoCatalogComparisonRecord[]>();
    for (const video of videos) {
      const channelVideos = videosByChannel.get(video.channelId) ?? [];
      channelVideos.push(video);
      videosByChannel.set(video.channelId, channelVideos);
    }

    const comparisonComplete = new Map<string, boolean>();
    for (const [id, pair] of pairs) {
      const channelVideos = videosByChannel.get(id) ?? [];
      comparisonComplete.set(
        id,
        isCompleteCatalogBucket(pair.previous, channelVideos) &&
          isCompleteCatalogBucket(pair.current, channelVideos),
      );
    }

    const unrankedItems: Array<DailyVideoLeader & { numericVideoDelta: bigint }> = [];
    for (const channel of channels) {
      const gain = channelGain.get(channel.id) ?? null;
      const pair = pairs.get(channel.id);
      if (pair === undefined || comparisonComplete.get(channel.id) !== true) {
        continue;
      }
      let best: { video: VideoCatalogComparisonRecord; delta: bigint } | undefined;
      for (const video of videosByChannel.get(channel.id) ?? []) {
        const previous = snapshotAtBucket(video, pair.previous.snapshotBucket);
        const current = snapshotAtBucket(video, pair.current.snapshotBucket);
        if (
          previous?.views === null ||
          previous === undefined ||
          current?.views === null ||
          current === undefined
        ) {
          continue;
        }
        const delta = current.views - previous.views;
        if (delta <= 0n) continue;
        if (
          best === undefined ||
          delta > best.delta ||
          (delta === best.delta &&
            video.youtubeVideoId.localeCompare(best.video.youtubeVideoId) < 0)
        ) {
          best = { video, delta };
        }
      }
      if (best === undefined) continue;
      unrankedItems.push({
        rank: 1,
        channelId: channel.id,
        channelTitle: channel.title,
        videoId: best.video.id,
        youtubeVideoId: best.video.youtubeVideoId,
        title: best.video.title,
        thumbnail: best.video.thumbnail,
        channelViewDelta: gain === null ? null : gain.toString(),
        videoViewDelta: best.delta.toString(),
        contributionPercent:
          gain !== null && gain > 0n ? contributionPercent(best.delta, gain) : null,
        baselineAt: pair.previous.capturedAt.toISOString(),
        capturedAt: pair.current.capturedAt.toISOString(),
        status: "COMPLETE",
        numericVideoDelta: best.delta,
      });
    }
    unrankedItems.sort(
      (left, right) =>
        compareBigIntDescending(left.numericVideoDelta, right.numericVideoDelta) ||
        left.channelTitle.localeCompare(right.channelTitle) ||
        left.youtubeVideoId.localeCompare(right.youtubeVideoId),
    );
    const items: DailyVideoLeader[] = unrankedItems.map((item, index) => ({
      rank: index + 1,
      channelId: item.channelId,
      channelTitle: item.channelTitle,
      videoId: item.videoId,
      youtubeVideoId: item.youtubeVideoId,
      title: item.title,
      thumbnail: item.thumbnail,
      channelViewDelta: item.channelViewDelta,
      videoViewDelta: item.videoViewDelta,
      contributionPercent: item.contributionPercent,
      baselineAt: item.baselineAt,
      capturedAt: item.capturedAt,
      status: item.status,
    }));

    const channelsWithUnavailableViews = channels.filter(
      (channel) => channelGain.get(channel.id) === null,
    ).length;
    const channelsWithDailyGain = channels.filter(
      (channel) => (channelGain.get(channel.id) ?? 0n) > 0n,
    ).length;
    const hasMissingPair = pairs.size < channels.length;
    const hasPartialCatalog =
      pairs.size > 0 &&
      ([...comparisonComplete.values()].some((complete) => !complete) || hasMissingPair);
    const channelsWithComparableCatalog = [...comparisonComplete.values()].filter(Boolean).length;
    const warnings: DailyVideoLeadersResponse["warnings"] = [];
    if (hasMissingPair) warnings.push("CATALOG_BASELINE_REQUIRED");
    if (hasPartialCatalog) warnings.push("CATALOG_COVERAGE_PARTIAL");
    if (channelsWithUnavailableViews > 0) warnings.push("CHANNEL_DAILY_VIEWS_UNAVAILABLE");
    if (channels.length > 0 && channelsWithDailyGain === 0 && channelsWithUnavailableViews === 0) {
      warnings.push("NO_POSITIVE_DAILY_GAIN");
    }
    const allDailyViewsKnown = channelsWithUnavailableViews === 0;
    const allCatalogComplete =
      pairs.size === channels.length &&
      [...comparisonComplete.values()].every((complete) => complete);
    const coverageStatus =
      channels.length === 0
        ? "UNAVAILABLE"
        : pairs.size === 0
          ? "WARMING_UP"
          : allDailyViewsKnown && allCatalogComplete
            ? "COMPLETE"
            : "PARTIAL";

    return DailyVideoLeadersResponseSchema.parse({
      date,
      previousDate,
      timeZone: this.dependencies.timeZone,
      source: "YTDLP_CATALOG_SNAPSHOTS",
      coverageStatus,
      totalChannels: channels.length,
      channelsWithDailyGain,
      channelsWithComparableCatalog,
      warnings,
      items,
    });
  }
}
