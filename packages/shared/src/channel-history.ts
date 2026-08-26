import type { ChannelActivity } from "./channel-contracts.js";

export interface NullableChannelMetrics {
  subscriberCount: bigint | null;
  videoCount: bigint | null;
  lifetimeViewCount: bigint | null;
}

export interface ChannelMetricDeltas {
  subscriberDelta: bigint | null;
  videoDelta: bigint | null;
  viewDelta: bigint | null;
}

export function deriveActivityStatus(
  lastUploadAt: Date | null,
  now: Date,
  activeUploadDays: number,
): ChannelActivity {
  if (lastUploadAt === null) return "NO_UPLOAD_HISTORY";
  const thresholdMs = activeUploadDays * 24 * 60 * 60 * 1_000;
  return now.getTime() - lastUploadAt.getTime() <= thresholdMs ? "ACTIVE_RECENT" : "DORMANT";
}

export function deriveMetricDeltas(
  current: NullableChannelMetrics,
  previous: NullableChannelMetrics | null,
): ChannelMetricDeltas {
  if (previous === null) {
    return { subscriberDelta: null, videoDelta: null, viewDelta: null };
  }
  return {
    subscriberDelta:
      current.subscriberCount !== null && previous.subscriberCount !== null
        ? current.subscriberCount - previous.subscriberCount
        : null,
    videoDelta:
      current.videoCount !== null && previous.videoCount !== null
        ? current.videoCount - previous.videoCount
        : null,
    viewDelta:
      current.lifetimeViewCount !== null && previous.lifetimeViewCount !== null
        ? current.lifetimeViewCount - previous.lifetimeViewCount
        : null,
  };
}

export function deriveCoverageStatus(metrics: NullableChannelMetrics): "COMPLETE" | "PARTIAL" {
  return Object.values(metrics).every((value) => value !== null) ? "COMPLETE" : "PARTIAL";
}

export function localCalendarDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Returns the UTC instant at which a configured local calendar day begins. */
export function localCalendarDateStart(date: string, timeZone: string): Date {
  const targetUtc = Date.parse(`${date}T00:00:00.000Z`);
  let candidate = targetUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  // Two passes normally suffice; four also covers an offset transition close to midnight.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const values = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
    );
    const representedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    const correction = targetUtc - representedAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }

  const result = new Date(candidate);
  if (localCalendarDate(result, timeZone) !== date) {
    throw new RangeError(`Unable to resolve local calendar date ${date}`);
  }
  return result;
}

export function previousCalendarDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}
