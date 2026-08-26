import { z } from "zod";

const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const NumericStringSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/u);

export const PublicMetricClassSchema = z.enum([
  "PUBLIC_CURRENT",
  "LOCAL_SNAPSHOT_DERIVED",
  "DETERMINISTIC_PUBLIC_METADATA",
]);

export const PublicMetricStatusSchema = z.enum(["READY", "WARMING_UP", "PARTIAL", "UNAVAILABLE"]);

export const PublicMetricPrecisionSchema = z.enum([
  "EXACT_AS_PUBLISHED",
  "ROUNDED_3_SIGNIFICANT_DIGITS",
  "ROUNDED_PUBLIC_DISPLAY",
  "DERIVED_FROM_EXACT_PUBLIC_COUNTERS",
  "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS",
  "SAMPLE_BASED",
]);

export const PublicMetricUnitSchema = z.enum(["COUNT", "SECONDS", "UPLOADS_PER_WEEK"]);

export const PublicMetricReasonSchema = z.enum([
  "NO_CURRENT_SNAPSHOT",
  "METRIC_NOT_PUBLIC",
  "INSUFFICIENT_HISTORY",
  "STALE_CURRENT_SNAPSHOT",
  "PARTIAL_BASELINE",
  "INCOMPLETE_CATALOG",
  "MISSING_DURATION_METADATA",
]);

export const PublicMetricProvenanceSchema = z.object({
  source: z.string().min(1).max(128),
  capturedAt: z.iso.datetime().nullable(),
  baselineDate: CalendarDateSchema.nullable(),
  method: z.string().min(1).max(128),
  methodVersion: z.string().min(1).max(64),
});

export const PublicIntelligenceMetricSchema = z.object({
  value: NumericStringSchema.nullable(),
  status: PublicMetricStatusSchema,
  metricClass: PublicMetricClassSchema,
  precision: PublicMetricPrecisionSchema,
  unit: PublicMetricUnitSchema,
  reason: PublicMetricReasonSchema.nullable(),
  provenance: PublicMetricProvenanceSchema,
});

const metricsSchema = z.object({
  lifetimeViews: PublicIntelligenceMetricSchema,
  subscribers: PublicIntelligenceMetricSchema,
  publicVideos: PublicIntelligenceMetricSchema,
  viewsGained: PublicIntelligenceMetricSchema,
  subscribersGained: PublicIntelligenceMetricSchema,
  publicInventoryDelta: PublicIntelligenceMetricSchema,
  publishedVideos: PublicIntelligenceMetricSchema,
  averageVideoDurationSeconds: PublicIntelligenceMetricSchema,
  uploadFrequencyPerWeek: PublicIntelligenceMetricSchema,
});

export const PublicIntelligenceWarningSchema = z.enum([
  "STALE_CURRENT_SNAPSHOT",
  "INCOMPLETE_DAILY_HISTORY",
  "SUBSCRIBER_COUNTS_ARE_ROUNDED",
  "INCOMPLETE_VIDEO_CATALOG",
  "MISSING_VIDEO_DURATIONS",
]);

export const PublicIntelligenceResponseSchema = z.object({
  channelId: z.uuid(),
  asOf: z.iso.datetime().nullable(),
  period: z.object({
    startDate: CalendarDateSchema,
    endDate: CalendarDateSchema,
    days: z.number().int().min(1).max(90),
    timeZone: z.string().min(1),
  }),
  metrics: metricsSchema,
  coverage: z.object({
    requestedDays: z.number().int().min(1).max(90),
    completeDays: z.number().int().nonnegative(),
    partialDays: z.number().int().nonnegative(),
    coveragePercent: z.number().min(0).max(100),
    hasCurrentSnapshot: z.boolean(),
    hasBaseline: z.boolean(),
    reportedPublicVideos: z.string().regex(/^\d+$/u).nullable(),
    knownPublicVideos: z.number().int().nonnegative(),
    durationKnownVideos: z.number().int().nonnegative(),
  }),
  warnings: z.array(PublicIntelligenceWarningSchema),
});

export type PublicMetricClass = z.infer<typeof PublicMetricClassSchema>;
export type PublicMetricStatus = z.infer<typeof PublicMetricStatusSchema>;
export type PublicMetricPrecision = z.infer<typeof PublicMetricPrecisionSchema>;
export type PublicMetricUnit = z.infer<typeof PublicMetricUnitSchema>;
export type PublicMetricReason = z.infer<typeof PublicMetricReasonSchema>;
export type PublicMetricProvenance = z.infer<typeof PublicMetricProvenanceSchema>;
export type PublicIntelligenceMetric = z.infer<typeof PublicIntelligenceMetricSchema>;
export type PublicIntelligenceWarning = z.infer<typeof PublicIntelligenceWarningSchema>;
export type PublicIntelligenceResponse = z.infer<typeof PublicIntelligenceResponseSchema>;
