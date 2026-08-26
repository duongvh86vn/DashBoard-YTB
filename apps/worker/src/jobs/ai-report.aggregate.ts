import type { AiEvidencePrecision, AiGroundingEvidence, AiReportCoverage } from "@yt-monitor/ai";
import type {
  ChannelDailyStatRecord,
  ChannelRecord,
  ChannelUnitOfWork,
  VideoRankingRecord,
  VideoSnapshotRecord,
} from "@yt-monitor/db";
import { localCalendarDateStart } from "@yt-monitor/shared";

export interface AiReportChannelAggregate {
  channelId: string;
  title: string;
  observedDays: number;
  completeDays: number;
  latestSubscriberCount: string | null;
  latestVideoCount: string | null;
  latestLifetimeViewCount: string | null;
  periodSubscriberDelta: string | null;
  periodVideoDelta: string | null;
  periodViewDelta: string | null;
}

export interface AiReportVideoAggregate {
  videoId: string;
  channelId: string;
  title: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  latestViews: string | null;
  latestLikes: string | null;
  latestComments: string | null;
  periodViewDelta: string | null;
  baselineAt: string | null;
  capturedAt: string | null;
}

export interface AiReportMetricSummary {
  schemaVersion: "canonical-ai-aggregate-v1";
  kind: "DAILY" | "WEEKLY";
  reportDate: string;
  periodStart: string;
  periodEnd: string;
  dataCutoffAt: string | null;
  coverage: AiReportCoverage;
  channels: AiReportChannelAggregate[];
  videos: AiReportVideoAggregate[];
  evidence: AiGroundingEvidence[];
}

export interface AiReportAggregate {
  kind: "DAILY" | "WEEKLY";
  reportDate: Date;
  channelIds: readonly string[];
  videoIds: readonly string[];
  metricSummary: AiReportMetricSummary;
}

const VIDEO_SNAPSHOT_BOUNDARY_TOLERANCE_MS = 6 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function stringify(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

function sumComplete(
  stats: readonly ChannelDailyStatRecord[],
  expectedDays: number,
  select: (stat: ChannelDailyStatRecord) => bigint | null,
): string | null {
  if (stats.length !== expectedDays) return null;
  const values = stats.map(select);
  if (values.some((value) => value === null)) return null;
  let total = 0n;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total.toString();
}

type RawPublicPrecision =
  "EXACT_AS_PUBLISHED" | "ROUNDED_3_SIGNIFICANT_DIGITS" | "ROUNDED_PUBLIC_DISPLAY";

function rawChannelPrecision(
  stat: ChannelDailyStatRecord,
  key: "subscriberCount" | "videoCount" | "lifetimeViewCount",
): RawPublicPrecision {
  const summary = stat.sourceSummary;
  if (typeof summary !== "object" || summary === null || Array.isArray(summary)) {
    return "ROUNDED_PUBLIC_DISPLAY";
  }
  const entry = (summary as Record<string, unknown>)[key];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return "ROUNDED_PUBLIC_DISPLAY";
  }
  const precision = (entry as Record<string, unknown>).precision;
  return precision === "EXACT_AS_PUBLISHED" ||
    precision === "ROUNDED_3_SIGNIFICANT_DIGITS" ||
    precision === "ROUNDED_PUBLIC_DISPLAY"
    ? precision
    : "ROUNDED_PUBLIC_DISPLAY";
}

function channelMetricPrecision(
  stat: ChannelDailyStatRecord,
  metric:
    | "subscriber_count"
    | "video_count"
    | "lifetime_view_count"
    | "subscriber_delta"
    | "video_delta"
    | "view_delta",
): AiEvidencePrecision {
  if (metric === "subscriber_count") return rawChannelPrecision(stat, "subscriberCount");
  if (metric === "video_count") return rawChannelPrecision(stat, "videoCount");
  if (metric === "lifetime_view_count") {
    return rawChannelPrecision(stat, "lifetimeViewCount");
  }
  // The canonical daily row does not retain enough provenance to prove the
  // precision of its previous-day baseline. Never promote a delta to exact
  // merely because today's counter was exact.
  return "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS";
}

function channelEvidence(
  channel: ChannelRecord,
  stats: readonly ChannelDailyStatRecord[],
): AiGroundingEvidence[] {
  return stats.flatMap((stat) => {
    const observedAt = dateString(stat.date);
    const coverage = stat.coverageStatus === "COMPLETE" ? "COMPLETE" : "PARTIAL";
    const values = [
      ["subscriber_count", stat.subscriberCount, "subscribers"],
      ["video_count", stat.videoCount, "videos"],
      ["lifetime_view_count", stat.lifetimeViewCount, "views"],
      ["subscriber_delta", stat.subscriberDelta, "subscribers"],
      ["video_delta", stat.videoDelta, "videos"],
      ["view_delta", stat.viewDelta, "views"],
    ] as const;
    return values.flatMap(([metric, value, unit]) =>
      value === null
        ? []
        : [
            {
              id: `channel:${channel.id}:${observedAt}:${metric}`,
              entityType: "CHANNEL" as const,
              entityId: channel.id,
              metric,
              value: value.toString(),
              unit,
              observedAt,
              source: "CHANNEL_DAILY_STAT" as const,
              coverage,
              precision: channelMetricPrecision(stat, metric),
              status: coverage === "COMPLETE" ? ("READY" as const) : ("PARTIAL" as const),
              reason: coverage === "COMPLETE" ? null : "PARTIAL_CHANNEL_DAY_COVERAGE",
            },
          ],
    );
  });
}

function usableSnapshot(
  snapshots: readonly VideoSnapshotRecord[],
  predicate: (snapshot: VideoSnapshotRecord) => boolean,
): VideoSnapshotRecord | null {
  return (
    [...snapshots]
      .filter((snapshot) => predicate(snapshot) && snapshot.views !== null)
      .sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime())[0] ?? null
  );
}

function videoAggregate(
  video: VideoRankingRecord,
  startBoundary: Date,
  endBoundary: Date,
  endBoundaryInclusive: boolean,
  periodStartDate: string,
  periodEndDate: string,
): {
  aggregate: AiReportVideoAggregate;
  evidence: AiGroundingEvidence[];
  deltaReady: boolean;
} {
  const latestBoundary = endBoundary.getTime();
  const baselineBoundary = startBoundary.getTime();
  const latest = usableSnapshot(
    video.snapshots,
    (snapshot) =>
      (endBoundaryInclusive
        ? snapshot.capturedAt.getTime() <= latestBoundary
        : snapshot.capturedAt.getTime() < latestBoundary) &&
      snapshot.capturedAt.getTime() >= latestBoundary - VIDEO_SNAPSHOT_BOUNDARY_TOLERANCE_MS,
  );
  const baseline = usableSnapshot(
    video.snapshots,
    (snapshot) =>
      snapshot.capturedAt.getTime() <= baselineBoundary &&
      snapshot.capturedAt.getTime() >= baselineBoundary - VIDEO_SNAPSHOT_BOUNDARY_TOLERANCE_MS,
  );
  const distinctObservations =
    latest !== null &&
    baseline !== null &&
    latest.id !== baseline.id &&
    latest.capturedAt.getTime() > baseline.capturedAt.getTime();
  const periodViewDelta =
    distinctObservations &&
    latest?.views !== null &&
    latest?.views !== undefined &&
    baseline?.views !== null &&
    baseline?.views !== undefined
      ? latest.views - baseline.views
      : null;
  const observedAt = latest ? latest.capturedAt.toISOString() : null;
  const aggregate: AiReportVideoAggregate = {
    videoId: video.id,
    channelId: video.channelId,
    title: video.title,
    publishedAt: video.publishedAt?.toISOString() ?? null,
    durationSeconds: video.durationSeconds,
    latestViews: stringify(latest?.views ?? null),
    latestLikes: stringify(latest?.likes ?? null),
    latestComments: stringify(latest?.comments ?? null),
    periodViewDelta: stringify(periodViewDelta),
    baselineAt: baseline?.capturedAt.toISOString() ?? null,
    capturedAt: observedAt,
  };
  const evidence: AiGroundingEvidence[] = [];
  if (video.title) {
    evidence.push({
      id: `video:${video.id}:title`,
      entityType: "VIDEO",
      entityId: video.id,
      metric: "title",
      value: video.title,
      unit: null,
      observedAt: video.lastSeenAt.toISOString(),
      source: "PUBLIC_VIDEO_METADATA",
      coverage: "COMPLETE",
      precision: "DETERMINISTIC_METADATA",
      status: "READY",
      reason: null,
    });
  }
  if (video.publishedAt) {
    evidence.push({
      id: `video:${video.id}:published_at`,
      entityType: "VIDEO",
      entityId: video.id,
      metric: "publishedAt",
      value: video.publishedAt.toISOString(),
      unit: null,
      observedAt: video.lastSeenAt.toISOString(),
      source: "PUBLIC_VIDEO_METADATA",
      coverage: "COMPLETE",
      precision: "DETERMINISTIC_METADATA",
      status: "READY",
      reason: null,
    });
  }
  if (video.durationSeconds !== null) {
    evidence.push({
      id: `video:${video.id}:duration_seconds`,
      entityType: "VIDEO",
      entityId: video.id,
      metric: "durationSeconds",
      value: video.durationSeconds.toString(),
      unit: "seconds",
      observedAt: video.lastSeenAt.toISOString(),
      source: "PUBLIC_VIDEO_METADATA",
      coverage: "COMPLETE",
      precision: "DETERMINISTIC_METADATA",
      status: "READY",
      reason: null,
    });
  }
  if (latest && observedAt) {
    for (const [metric, value, unit] of [
      ["views", latest.views, "views"],
      ["likes", latest.likes, "likes"],
      ["comments", latest.comments, "comments"],
    ] as const) {
      if (value !== null) {
        evidence.push({
          id: `video:${video.id}:${dateString(latest.capturedAt)}:${metric}`,
          entityType: "VIDEO",
          entityId: video.id,
          metric,
          value: value.toString(),
          unit,
          observedAt,
          source: "VIDEO_SNAPSHOT",
          coverage: "COMPLETE",
          precision: "EXACT_AS_PUBLISHED",
          status: "READY",
          reason: null,
        });
      }
    }
  }
  if (periodViewDelta !== null && latest && baseline) {
    evidence.push({
      id: `video:${video.id}:${periodStartDate}:${periodEndDate}:view_delta`,
      entityType: "VIDEO",
      entityId: video.id,
      metric: "viewDelta",
      value: periodViewDelta.toString(),
      unit: "views",
      observedAt: latest.capturedAt.toISOString(),
      source: "DERIVED_CANONICAL_SNAPSHOTS",
      coverage: "COMPLETE",
      precision: "DERIVED_FROM_EXACT_PUBLIC_COUNTERS",
      status: "READY",
      reason: null,
    });
  }
  return { aggregate, evidence, deltaReady: periodViewDelta !== null };
}

export class AiReportAggregateBuilder {
  constructor(
    private readonly dependencies: {
      unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
      maxVideos?: number;
      timeZone?: string;
      now?: () => Date;
    },
  ) {}

  async build(
    kind: "DAILY" | "WEEKLY",
    reportDate: Date,
    scheduledCutoffAt?: Date,
  ): Promise<AiReportAggregate> {
    const expectedDays = kind === "DAILY" ? 1 : 7;
    const periodEnd = utcDate(dateString(reportDate));
    const periodStart = addUtcDays(periodEnd, -(expectedDays - 1));
    const periodStartDate = dateString(periodStart);
    const periodEndDate = dateString(periodEnd);
    const timeZone = this.dependencies.timeZone ?? "UTC";
    const reportDayEnd = localCalendarDateStart(dateString(addUtcDays(periodEnd, 1)), timeZone);
    const dataBoundaryAt = scheduledCutoffAt ?? (this.dependencies.now ?? (() => new Date()))();
    const endBoundaryInclusive = dataBoundaryAt.getTime() < reportDayEnd.getTime();
    const videoEndBoundary = endBoundaryInclusive ? dataBoundaryAt : reportDayEnd;
    const videoStartBoundary = new Date(videoEndBoundary.getTime() - expectedDays * DAY_MS);
    const source = await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const channels = await repositories.channels.listEnabled();
      const channelIds = channels.map((channel) => channel.id);
      const [stats, videos] = await Promise.all([
        repositories.dailyStats.listByChannelsAndDateRange(channelIds, periodStart, periodEnd),
        repositories.videos.listForRanking({ take: this.dependencies.maxVideos ?? 100 }),
      ]);
      return {
        channels,
        stats,
        videos: videos.filter((video) => channelIds.includes(video.channelId)),
      };
    });

    const channelIds = source.channels.map((channel) => channel.id).sort();
    const statsByChannel = new Map<string, ChannelDailyStatRecord[]>();
    for (const stat of source.stats) {
      const items = statsByChannel.get(stat.channelId) ?? [];
      items.push(stat);
      statsByChannel.set(stat.channelId, items);
    }
    const evidence: AiGroundingEvidence[] = [];
    const channels = source.channels
      .map((channel): AiReportChannelAggregate => {
        const stats = (statsByChannel.get(channel.id) ?? []).sort(
          (left, right) => left.date.getTime() - right.date.getTime(),
        );
        const latest = stats.at(-1) ?? null;
        evidence.push(...channelEvidence(channel, stats));
        return {
          channelId: channel.id,
          title: channel.title,
          observedDays: stats.length,
          completeDays: stats.filter((stat) => stat.coverageStatus === "COMPLETE").length,
          latestSubscriberCount: stringify(latest?.subscriberCount ?? null),
          latestVideoCount: stringify(latest?.videoCount ?? null),
          latestLifetimeViewCount: stringify(latest?.lifetimeViewCount ?? null),
          periodSubscriberDelta: sumComplete(stats, expectedDays, (stat) => stat.subscriberDelta),
          periodVideoDelta: sumComplete(stats, expectedDays, (stat) => stat.videoDelta),
          periodViewDelta: sumComplete(stats, expectedDays, (stat) => stat.viewDelta),
        };
      })
      .sort((left, right) => left.channelId.localeCompare(right.channelId));

    const videoResults = source.videos.map((video) =>
      videoAggregate(
        video,
        videoStartBoundary,
        videoEndBoundary,
        endBoundaryInclusive,
        periodStartDate,
        periodEndDate,
      ),
    );
    videoResults.sort((left, right) => {
      const leftGain = left.aggregate.periodViewDelta;
      const rightGain = right.aggregate.periodViewDelta;
      if (leftGain !== null && rightGain !== null) {
        const difference = BigInt(rightGain) - BigInt(leftGain);
        if (difference !== 0n) return difference > 0n ? 1 : -1;
      } else if (leftGain !== null) return -1;
      else if (rightGain !== null) return 1;
      const leftViews = BigInt(left.aggregate.latestViews ?? "-1");
      const rightViews = BigInt(right.aggregate.latestViews ?? "-1");
      if (leftViews !== rightViews) return rightViews > leftViews ? 1 : -1;
      return left.aggregate.videoId.localeCompare(right.aggregate.videoId);
    });
    const selectedVideos = videoResults.slice(0, 20);
    for (const item of selectedVideos) evidence.push(...item.evidence);

    const observedChannelDays = source.stats.length;
    const expectedChannelDays = source.channels.length * expectedDays;
    const completeChannelDays = source.stats.filter(
      (stat) => stat.coverageStatus === "COMPLETE",
    ).length;
    const distinctDates = new Set(source.stats.map((stat) => dateString(stat.date))).size;
    const canonicalMetricEvidence = evidence.filter(
      (item) => item.source !== "PUBLIC_VIDEO_METADATA",
    ).length;
    const hasIncompleteVideoWindow =
      selectedVideos.length > 0 && selectedVideos.some((item) => !item.deltaReady);
    let coverage: AiReportCoverage;
    if (source.channels.length === 0) {
      coverage = {
        status: "INSUFFICIENT",
        expectedChannelDays,
        observedChannelDays,
        completeChannelDays,
        reason: "NO_ENABLED_CHANNELS",
      };
    } else if (source.stats.length === 0) {
      coverage = {
        status: "INSUFFICIENT",
        expectedChannelDays,
        observedChannelDays,
        completeChannelDays,
        reason: "NO_CANONICAL_DAILY_STATS",
      };
    } else if (canonicalMetricEvidence === 0) {
      coverage = {
        status: "INSUFFICIENT",
        expectedChannelDays,
        observedChannelDays,
        completeChannelDays,
        reason: "NO_CANONICAL_METRICS",
      };
    } else if (kind === "WEEKLY" && distinctDates < 2) {
      coverage = {
        status: "INSUFFICIENT",
        expectedChannelDays,
        observedChannelDays,
        completeChannelDays,
        reason: "INSUFFICIENT_HISTORY",
      };
    } else if (hasIncompleteVideoWindow) {
      coverage = {
        status: "PARTIAL",
        expectedChannelDays,
        observedChannelDays,
        completeChannelDays,
        reason: "INSUFFICIENT_HISTORY",
      };
    } else {
      coverage = {
        status:
          observedChannelDays === expectedChannelDays && completeChannelDays === expectedChannelDays
            ? "COMPLETE"
            : "PARTIAL",
        expectedChannelDays,
        observedChannelDays,
        completeChannelDays,
        reason: null,
      };
    }
    evidence.push({
      id: `portfolio:${dateString(periodStart)}:${dateString(periodEnd)}:coverage`,
      entityType: "PORTFOLIO",
      entityId: null,
      metric: "channelDayCoverage",
      value: `${observedChannelDays}/${expectedChannelDays}`,
      unit: "channel-days",
      observedAt: dateString(periodEnd),
      source: "DERIVED_COVERAGE",
      coverage: coverage.status === "COMPLETE" ? "COMPLETE" : "PARTIAL",
      precision: "COVERAGE_RATIO",
      status: coverage.status === "COMPLETE" ? "READY" : "PARTIAL",
      reason:
        coverage.status === "COMPLETE"
          ? null
          : (coverage.reason ?? "INCOMPLETE_CHANNEL_DAY_COVERAGE"),
    });
    evidence.sort((left, right) => left.id.localeCompare(right.id));
    const videos = selectedVideos.map((item) => item.aggregate);

    return {
      kind,
      reportDate: periodEnd,
      channelIds,
      videoIds: videos.map((video) => video.videoId).sort(),
      metricSummary: {
        schemaVersion: "canonical-ai-aggregate-v1",
        kind,
        reportDate: dateString(periodEnd),
        periodStart: dateString(periodStart),
        periodEnd: dateString(periodEnd),
        dataCutoffAt: scheduledCutoffAt?.toISOString() ?? null,
        coverage,
        channels,
        videos,
        evidence,
      },
    };
  }
}
