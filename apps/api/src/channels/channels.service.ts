import type {
  ChannelDailyStatRecord,
  ChannelPublicVideoSummary,
  ChannelUnitOfWork,
  ChannelRecord,
  ChannelHealthCheckRecord,
  ChannelSnapshotRecord,
  SyncRunRecord,
} from "@yt-monitor/db";
import { ChannelConflictError, ChannelNotFoundError } from "@yt-monitor/db";
import { ChannelInputError, YtdlpError } from "@yt-monitor/collector-ytdlp";
import {
  PublicIntelligenceResponseSchema,
  localCalendarDate,
  localCalendarDateStart,
  previousCalendarDate,
  type PublicIntelligenceMetric,
  type PublicIntelligenceResponse,
  type PublicMetricPrecision,
  type PublicMetricReason,
  type PublicMetricStatus,
  type PublicMetricUnit,
} from "@yt-monitor/shared";

import { ChannelApplicationError } from "./channel-application.error.js";
import type {
  ChannelsApplicationPort,
  ChannelProviderPort,
  PublicChannel,
  PublicChannelHealthCheck,
  SyncRunsPage,
} from "./channels-application.port.js";
import type {
  ChannelAccessResolverPort,
  ChannelAccessSubject,
} from "../channel-groups/channel-groups-application.port.js";

interface ChannelsServiceDependencies {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  access: ChannelAccessResolverPort;
  provider: ChannelProviderPort;
  timeZone?: string;
  now?: () => Date;
}

type CounterKey = "subscriberCount" | "videoCount" | "lifetimeViewCount";

// Channel current stats run every six hours. Two missed collection windows are
// the point where a "current" public counter must be presented as partial.
const CURRENT_SNAPSHOT_STALE_AFTER_MS = 12 * 60 * 60 * 1_000;

function shiftCalendarDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function metric(input: {
  value: string | null;
  status: PublicMetricStatus;
  metricClass: PublicIntelligenceMetric["metricClass"];
  precision: PublicMetricPrecision;
  unit?: PublicMetricUnit;
  reason?: PublicMetricReason | null;
  source: string;
  capturedAt: Date | null;
  baselineDate?: string | null;
  method: string;
  methodVersion: string;
}): PublicIntelligenceMetric {
  return {
    value: input.value,
    status: input.status,
    metricClass: input.metricClass,
    precision: input.precision,
    unit: input.unit ?? "COUNT",
    reason: input.reason ?? null,
    provenance: {
      source: input.source,
      capturedAt: input.capturedAt?.toISOString() ?? null,
      baselineDate: input.baselineDate ?? null,
      method: input.method,
      methodVersion: input.methodVersion,
    },
  };
}

function snapshotMetricSource(snapshot: ChannelSnapshotRecord | null, key: CounterKey): string {
  if (snapshot === null) return "YOUTUBE_PUBLIC_PAGE";
  const details = snapshot.sourceDetails;
  if (typeof details === "object" && details !== null && !Array.isArray(details)) {
    const candidate = (details as Record<string, unknown>)[key];
    if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) {
      const source = (candidate as Record<string, unknown>).source;
      if (typeof source === "string" && source.length > 0) return source;
    }
  }
  return snapshot.source;
}

function snapshotMetricPrecision(
  snapshot: ChannelSnapshotRecord | null,
  key: CounterKey,
  fallback: PublicMetricPrecision,
): PublicMetricPrecision {
  if (snapshot === null) return fallback;
  const details = snapshot.sourceDetails;
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

function dailyStatMetricPrecision(
  stat: ChannelDailyStatRecord | undefined,
  key: CounterKey,
): PublicMetricPrecision {
  if (stat === undefined) return "ROUNDED_PUBLIC_DISPLAY";
  const summary = stat.sourceSummary;
  if (typeof summary === "object" && summary !== null && !Array.isArray(summary)) {
    const candidate = (summary as Record<string, unknown>)[key];
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
  // Rows written before field-level precision was available cannot prove an
  // exact baseline. Conservatively treat them as rounded.
  return "ROUNDED_PUBLIC_DISPLAY";
}

function derivedMetricPrecision(
  current: PublicMetricPrecision,
  baseline: PublicMetricPrecision,
): PublicMetricPrecision {
  return current === "EXACT_AS_PUBLISHED" && baseline === "EXACT_AS_PUBLISHED"
    ? "DERIVED_FROM_EXACT_PUBLIC_COUNTERS"
    : "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS";
}

function isCurrentSnapshotStale(snapshot: ChannelSnapshotRecord | null, now: Date): boolean {
  return (
    snapshot !== null &&
    now.getTime() - snapshot.capturedAt.getTime() > CURRENT_SNAPSHOT_STALE_AFTER_MS
  );
}

function currentCounterMetric(input: {
  snapshot: ChannelSnapshotRecord | null;
  key: CounterKey;
  precision: PublicMetricPrecision;
  stale: boolean;
}): PublicIntelligenceMetric {
  const value = input.snapshot?.[input.key] ?? null;
  return metric({
    value: value?.toString() ?? null,
    status:
      value === null ? "UNAVAILABLE" : input.stale ? "PARTIAL" : ("READY" as PublicMetricStatus),
    metricClass: "PUBLIC_CURRENT",
    precision: input.precision,
    reason:
      input.snapshot === null
        ? "NO_CURRENT_SNAPSHOT"
        : value === null
          ? "METRIC_NOT_PUBLIC"
          : input.stale
            ? "STALE_CURRENT_SNAPSHOT"
            : null,
    source: snapshotMetricSource(input.snapshot, input.key),
    capturedAt: input.snapshot?.capturedAt ?? null,
    method: "public-channel-current",
    methodVersion: "v1",
  });
}

function derivedCounterMetric(input: {
  snapshot: ChannelSnapshotRecord | null;
  baseline: ChannelDailyStatRecord | undefined;
  key: CounterKey;
  precision: PublicMetricPrecision;
  stale: boolean;
  baselineDate: string;
}): PublicIntelligenceMetric {
  const current = input.snapshot?.[input.key] ?? null;
  const baseline = input.baseline?.[input.key] ?? null;
  let status: PublicMetricStatus;
  let reason: PublicMetricReason | null = null;
  let value: string | null = null;

  if (current === null) {
    status = input.snapshot === null ? "WARMING_UP" : "UNAVAILABLE";
    reason = input.snapshot === null ? "NO_CURRENT_SNAPSHOT" : "METRIC_NOT_PUBLIC";
  } else if (baseline === null) {
    status = "WARMING_UP";
    reason = "INSUFFICIENT_HISTORY";
  } else {
    value = (current - baseline).toString();
    if (input.stale) {
      status = "PARTIAL";
      reason = "STALE_CURRENT_SNAPSHOT";
    } else if (input.baseline?.coverageStatus !== "COMPLETE") {
      status = "PARTIAL";
      reason = "PARTIAL_BASELINE";
    } else {
      status = "READY";
    }
  }

  return metric({
    value,
    status,
    metricClass: "LOCAL_SNAPSHOT_DERIVED",
    precision: input.precision,
    reason,
    source: "LOCAL_CHANNEL_SNAPSHOTS",
    capturedAt: input.snapshot?.capturedAt ?? null,
    baselineDate: input.baselineDate,
    method: "signed-counter-delta",
    methodVersion: "v1",
  });
}

function catalogMetric(input: {
  value: string | null;
  summary: ChannelPublicVideoSummary;
  unit?: PublicMetricUnit;
  reason?: PublicMetricReason;
  method: string;
}): PublicIntelligenceMetric {
  const waiting = input.summary.catalogObservedAt === null;
  return metric({
    value: waiting ? null : input.value,
    status: waiting ? "WARMING_UP" : "PARTIAL",
    metricClass: "DETERMINISTIC_PUBLIC_METADATA",
    precision: "SAMPLE_BASED",
    ...(input.unit ? { unit: input.unit } : {}),
    reason: waiting ? "INCOMPLETE_CATALOG" : (input.reason ?? "INCOMPLETE_CATALOG"),
    source: "LOCAL_VIDEO_CATALOG",
    capturedAt: input.summary.catalogObservedAt,
    method: input.method,
    methodVersion: "v1",
  });
}

function formatDecimal(value: number): string {
  return value
    .toFixed(2)
    .replace(/\.00$/u, "")
    .replace(/(\.\d)0$/u, "$1");
}

function dailyCoverage(input: {
  days: number;
  startDate: string;
  endDate: string;
  snapshot: ChannelSnapshotRecord | null;
  stats: readonly ChannelDailyStatRecord[];
  timeZone: string;
  currentSnapshotStale: boolean;
}): { completeDays: number; partialDays: number; coveragePercent: number } {
  const statsByDate = new Map(input.stats.map((row) => [dateKey(row.date), row]));
  let completeDays = 0;
  let partialDays = 0;
  for (let offset = 0; offset < input.days; offset += 1) {
    const date = shiftCalendarDate(input.startDate, offset);
    const hasCurrent =
      date === input.endDate &&
      input.snapshot !== null &&
      localCalendarDate(input.snapshot.capturedAt, input.timeZone) === input.endDate;
    if (hasCurrent && input.snapshot !== null) {
      const complete =
        !input.currentSnapshotStale &&
        input.snapshot.subscriberCount !== null &&
        input.snapshot.videoCount !== null &&
        input.snapshot.lifetimeViewCount !== null;
      if (complete) completeDays += 1;
      else partialDays += 1;
      continue;
    }
    const row = statsByDate.get(date);
    if (row?.coverageStatus === "COMPLETE") completeDays += 1;
    else if (row !== undefined) partialDays += 1;
  }
  return {
    completeDays,
    partialDays,
    coveragePercent: Math.round((completeDays / input.days) * 1_000) / 10,
  };
}

function toPublicChannel(channel: ChannelRecord): PublicChannel {
  return {
    id: channel.id,
    youtubeChannelId: channel.youtubeChannelId,
    originalInput: channel.originalInput,
    canonicalUrl: channel.canonicalUrl,
    handle: channel.handle,
    title: channel.title,
    description: channel.description,
    thumbnail: channel.thumbnail,
    subscriberCount: channel.subscriberCount?.toString() ?? null,
    videoCount: channel.videoCount?.toString() ?? null,
    lifetimeViewCount: channel.lifetimeViewCount?.toString() ?? null,
    lastUploadAt: channel.lastUploadAt?.toISOString() ?? null,
    availabilityStatus: channel.availabilityStatus,
    activityStatus: channel.activityStatus,
    lastChannelScanAt: channel.lastChannelScanAt?.toISOString() ?? null,
    lastHealthCheckAt: channel.lastHealthCheckAt?.toISOString() ?? null,
    lastSeenAliveAt: channel.lastSeenAliveAt?.toISOString() ?? null,
    isEnabled: channel.isEnabled,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
    archivedAt: channel.archivedAt?.toISOString() ?? null,
  };
}

function mapChannelError(error: unknown): never {
  if (error instanceof ChannelConflictError) throw ChannelApplicationError.alreadyExists();
  if (error instanceof ChannelNotFoundError) throw ChannelApplicationError.notFound();
  if (error instanceof ChannelInputError) throw ChannelApplicationError.validation();
  if (error instanceof YtdlpError && error.code === "YTDLP_NOT_FOUND") {
    throw ChannelApplicationError.resolveFailed();
  }
  throw error;
}

function toPublicHealthCheck(check: ChannelHealthCheckRecord): PublicChannelHealthCheck {
  return {
    id: check.id,
    channelId: check.channelId,
    checkedAt: check.checkedAt.toISOString(),
    publicPageStatus: check.publicPageStatus,
    ytdlpStatus: check.ytdlpStatus,
    rssStatus: check.rssStatus,
    normalizedAvailability: check.normalizedAvailability,
    evidenceCode: check.evidenceCode,
    evidenceTextSafe: check.evidenceTextSafe,
    httpStatus: check.httpStatus,
    durationMs: check.durationMs,
    createdAt: check.createdAt.toISOString(),
  };
}

function toPublicSyncRun(run: SyncRunRecord): SyncRunsPage["items"][number] {
  return {
    id: run.id,
    channelId: run.channelId,
    jobType: run.jobType,
    status: run.status,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    recordsProcessed: run.recordsProcessed,
    errorCode: run.errorCode,
    errorMessageSafe: run.errorMessageSafe,
    createdAt: run.createdAt.toISOString(),
  };
}

export class ChannelsService implements ChannelsApplicationPort {
  constructor(private readonly dependencies: ChannelsServiceDependencies) {}

  private async visibleChannelIds(subject: ChannelAccessSubject): Promise<string[] | null> {
    return this.dependencies.access.resolveVisibleChannelIds(subject);
  }

  private async assertVisible(id: string, subject: ChannelAccessSubject): Promise<void> {
    const visible = await this.visibleChannelIds(subject);
    if (visible !== null && !visible.includes(id)) throw ChannelApplicationError.notFound();
  }

  async list(input: {
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<{
    items: PublicChannel[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const channelIds = await this.visibleChannelIds(input.subject);
    const page = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.channels.list({
        page: input.page,
        pageSize: input.pageSize,
        ...(channelIds === null ? {} : { channelIds }),
      }),
    );
    return {
      items: page.items.map(toPublicChannel),
      page: input.page,
      pageSize: input.pageSize,
      total: page.total,
    };
  }

  async get(input: { id: string; subject: ChannelAccessSubject }): Promise<PublicChannel> {
    await this.assertVisible(input.id, input.subject);
    const channel = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.channels.findById(input.id),
    );
    if (channel === null) throw ChannelApplicationError.notFound();
    return toPublicChannel(channel);
  }

  async publicIntelligence(input: {
    id: string;
    days: number;
    subject: ChannelAccessSubject;
  }): Promise<PublicIntelligenceResponse> {
    await this.assertVisible(input.id, input.subject);
    const timeZone = this.dependencies.timeZone ?? "UTC";
    const now = (this.dependencies.now ?? (() => new Date()))();
    const endDate = localCalendarDate(now, timeZone);
    const startDate = shiftCalendarDate(endDate, -(input.days - 1));
    const baselineDate = previousCalendarDate(startDate);
    const databaseStart = new Date(`${baselineDate}T00:00:00.000Z`);
    const databaseEnd = new Date(`${endDate}T00:00:00.000Z`);
    const videoStart = localCalendarDateStart(startDate, timeZone);
    const nextLocalDay = localCalendarDateStart(shiftCalendarDate(endDate, 1), timeZone);
    const videoEndExclusive = new Date(Math.min(nextLocalDay.getTime(), now.getTime() + 1));

    const { snapshot, stats, videoSummary } = await this.dependencies.unitOfWork.transaction(
      async (repositories) => {
        const channel = await repositories.channels.findById(input.id);
        if (channel === null) throw ChannelApplicationError.notFound();
        const [snapshot, stats, videoSummary] = await Promise.all([
          repositories.channels.latestSnapshot(input.id),
          repositories.dailyStats.listByChannelsAndDateRange(
            [input.id],
            databaseStart,
            databaseEnd,
          ),
          repositories.videos.summarizePublicCatalog(input.id, videoStart, videoEndExclusive),
        ]);
        return { snapshot, stats, videoSummary };
      },
    );

    const baseline = stats.find((row) => dateKey(row.date) === baselineDate);
    const stale = isCurrentSnapshotStale(snapshot, now);
    const coverage = dailyCoverage({
      days: input.days,
      startDate,
      endDate,
      snapshot,
      stats,
      timeZone,
      currentSnapshotStale: stale,
    });
    const lifetimePrecision = snapshotMetricPrecision(
      snapshot,
      "lifetimeViewCount",
      "ROUNDED_PUBLIC_DISPLAY",
    );
    const publicVideoPrecision = snapshotMetricPrecision(
      snapshot,
      "videoCount",
      "ROUNDED_PUBLIC_DISPLAY",
    );
    const lifetimeDerivedPrecision = derivedMetricPrecision(
      lifetimePrecision,
      dailyStatMetricPrecision(baseline, "lifetimeViewCount"),
    );
    const publicVideoDerivedPrecision = derivedMetricPrecision(
      publicVideoPrecision,
      dailyStatMetricPrecision(baseline, "videoCount"),
    );
    const averageDuration =
      videoSummary.durationKnownVideos > 0
        ? formatDecimal(videoSummary.durationSecondsTotal / videoSummary.durationKnownVideos)
        : null;
    const catalogReason: PublicMetricReason =
      videoSummary.durationKnownVideos < videoSummary.knownPublicVideos
        ? "MISSING_DURATION_METADATA"
        : "INCOMPLETE_CATALOG";

    const warnings = new Set<PublicIntelligenceResponse["warnings"][number]>([
      "SUBSCRIBER_COUNTS_ARE_ROUNDED",
      "INCOMPLETE_VIDEO_CATALOG",
    ]);
    if (stale) warnings.add("STALE_CURRENT_SNAPSHOT");
    if (coverage.completeDays < input.days) warnings.add("INCOMPLETE_DAILY_HISTORY");
    if (videoSummary.durationKnownVideos < videoSummary.knownPublicVideos) {
      warnings.add("MISSING_VIDEO_DURATIONS");
    }

    return PublicIntelligenceResponseSchema.parse({
      channelId: input.id,
      asOf: snapshot?.capturedAt.toISOString() ?? null,
      period: { startDate, endDate, days: input.days, timeZone },
      metrics: {
        lifetimeViews: currentCounterMetric({
          snapshot,
          key: "lifetimeViewCount",
          precision: lifetimePrecision,
          stale,
        }),
        subscribers: currentCounterMetric({
          snapshot,
          key: "subscriberCount",
          precision: "ROUNDED_3_SIGNIFICANT_DIGITS",
          stale,
        }),
        publicVideos: currentCounterMetric({
          snapshot,
          key: "videoCount",
          precision: publicVideoPrecision,
          stale,
        }),
        viewsGained: derivedCounterMetric({
          snapshot,
          baseline,
          key: "lifetimeViewCount",
          precision: lifetimeDerivedPrecision,
          stale,
          baselineDate,
        }),
        subscribersGained: derivedCounterMetric({
          snapshot,
          baseline,
          key: "subscriberCount",
          precision: "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS",
          stale,
          baselineDate,
        }),
        publicInventoryDelta: derivedCounterMetric({
          snapshot,
          baseline,
          key: "videoCount",
          precision: publicVideoDerivedPrecision,
          stale,
          baselineDate,
        }),
        publishedVideos: catalogMetric({
          value: videoSummary.publishedVideos.toString(),
          summary: videoSummary,
          method: "observed-published-at-window-count",
        }),
        averageVideoDurationSeconds: catalogMetric({
          value: averageDuration,
          summary: videoSummary,
          unit: "SECONDS",
          reason: catalogReason,
          method: "known-video-duration-average",
        }),
        uploadFrequencyPerWeek: catalogMetric({
          value: formatDecimal((videoSummary.publishedVideos * 7) / input.days),
          summary: videoSummary,
          unit: "UPLOADS_PER_WEEK",
          method: "observed-upload-frequency",
        }),
      },
      coverage: {
        requestedDays: input.days,
        ...coverage,
        hasCurrentSnapshot: snapshot !== null,
        hasBaseline: baseline !== undefined,
        reportedPublicVideos: snapshot?.videoCount?.toString() ?? null,
        knownPublicVideos: videoSummary.knownPublicVideos,
        durationKnownVideos: videoSummary.durationKnownVideos,
      },
      warnings: [...warnings],
    });
  }

  async create(input: { originalInput: string }): Promise<PublicChannel> {
    let resolved;
    try {
      resolved = await this.dependencies.provider.resolveChannel(input.originalInput);
    } catch (error) {
      if (error instanceof ChannelInputError) throw ChannelApplicationError.validation();
      if (error instanceof YtdlpError) throw ChannelApplicationError.resolveFailed();
      throw error;
    }
    if (resolved === null) throw ChannelApplicationError.resolveFailed();

    try {
      const created = await this.dependencies.unitOfWork.transaction((repositories) =>
        repositories.channels.create({ originalInput: input.originalInput, resolved }),
      );
      return toPublicChannel(created);
    } catch (error) {
      return mapChannelError(error);
    }
  }

  async archive(input: { id: string }): Promise<void> {
    try {
      await this.dependencies.unitOfWork.transaction((repositories) =>
        repositories.channels.archive(input.id, new Date()),
      );
    } catch (error) {
      return mapChannelError(error);
    }
  }

  async requestHealthCheck(input: {
    id: string;
  }): Promise<{ syncRunId: string; status: "QUEUED" }> {
    const syncRun = await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const channel = await repositories.channels.findById(input.id);
      if (channel === null) throw ChannelApplicationError.notFound();
      return repositories.syncRuns.create({
        channelId: input.id,
        jobType: "CHANNEL_HEALTH",
        status: "QUEUED",
      });
    });
    return { syncRunId: syncRun.id, status: "QUEUED" };
  }

  async healthHistory(input: {
    id: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<{
    items: PublicChannelHealthCheck[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    await this.assertVisible(input.id, input.subject);
    const result = await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const channel = await repositories.channels.findById(input.id);
      if (channel === null) throw ChannelApplicationError.notFound();
      return repositories.healthChecks.list(input.id, input.page, input.pageSize);
    });
    return {
      items: result.items.map(toPublicHealthCheck),
      page: input.page,
      pageSize: input.pageSize,
      total: result.total,
    };
  }

  async syncRuns(input: { page: number; pageSize: number }): Promise<SyncRunsPage> {
    const result = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.syncRuns.list(input),
    );
    return {
      items: result.items.map(toPublicSyncRun),
      page: input.page,
      pageSize: input.pageSize,
      total: result.total,
    };
  }
}
