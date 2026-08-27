import { z } from "zod";

const SignedIntegerStringSchema = z.string().regex(/^-?\d+$/u);
const NonnegativeIntegerStringSchema = z.string().regex(/^\d+$/u);
const SignedUsdSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u);
const NonnegativeUsdSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u);
const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const TimestampSchema = z.iso.datetime();

export const DashboardObservedMetricSchema = z
  .object({
    value: SignedIntegerStringSchema.nullable(),
    coveredChannels: z.number().int().nonnegative(),
    totalChannels: z.number().int().nonnegative(),
    status: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
  })
  .superRefine((metric, context) => {
    if (metric.coveredChannels > metric.totalChannels) {
      context.addIssue({
        code: "custom",
        message: "coveredChannels cannot exceed totalChannels",
        path: ["coveredChannels"],
      });
    }
    if (
      metric.status === "UNAVAILABLE" &&
      (metric.value !== null || metric.coveredChannels !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "UNAVAILABLE metrics must remain null with zero covered channels",
      });
    }
    if (
      metric.status === "PARTIAL" &&
      (metric.value === null ||
        metric.coveredChannels === 0 ||
        metric.coveredChannels >= metric.totalChannels)
    ) {
      context.addIssue({
        code: "custom",
        message: "PARTIAL metrics require a value from a strict subset of channels",
      });
    }
    if (
      metric.status === "COMPLETE" &&
      (metric.value === null ||
        metric.totalChannels === 0 ||
        metric.coveredChannels !== metric.totalChannels)
    ) {
      context.addIssue({
        code: "custom",
        message: "COMPLETE metrics require every channel and a real value",
      });
    }
  });

const DashboardObservedDeltasSchema = z.object({
  viewDelta: DashboardObservedMetricSchema,
  subscriberDelta: DashboardObservedMetricSchema,
});

export const DashboardTrendPointSchema = z.object({
  date: CalendarDateSchema,
  viewDelta: SignedIntegerStringSchema.nullable(),
  subscriberDelta: SignedIntegerStringSchema.nullable(),
  // Additive for clients that still consume the strict all-channel fields above.
  observed: DashboardObservedDeltasSchema.optional(),
  publishedVideos: z.number().int().nonnegative(),
  hasSnapshot: z.boolean(),
});

export const DashboardTrendResponseSchema = z
  .object({
    period: z.object({
      startDate: CalendarDateSchema,
      endDate: CalendarDateSchema,
      days: z.number().int().min(1).max(90),
      timeZone: z.string().min(1),
    }),
    totals: z.object({
      viewDelta: SignedIntegerStringSchema.nullable(),
      subscriberDelta: SignedIntegerStringSchema.nullable(),
      publishedVideos: z.number().int().nonnegative(),
    }),
    // Strict totals stay backward compatible. Observed totals make a partial
    // cohort visible without converting missing channel metrics into zero.
    observedTotals: DashboardObservedDeltasSchema.optional(),
    coverage: z.object({
      totalChannels: z.number().int().nonnegative(),
      channelsWithCurrentSnapshot: z.number().int().nonnegative(),
      channelsScanned: z.number().int().nonnegative().optional(),
      channelsWithCompleteCurrentSnapshot: z.number().int().nonnegative().optional(),
      channelsWithCurrentSubscribers: z.number().int().nonnegative().optional(),
      channelsWithCurrentLifetimeViews: z.number().int().nonnegative().optional(),
      channelsWithCurrentPublicVideos: z.number().int().nonnegative().optional(),
      channelsWithBaseline: z.number().int().nonnegative(),
      requestedDays: z.number().int().min(1).max(90),
      completeDays: z.number().int().nonnegative(),
      partialDays: z.number().int().nonnegative(),
      coveragePercent: z.number().min(0).max(100),
    }),
    series: z.array(DashboardTrendPointSchema),
  })
  .superRefine((response, context) => {
    const totalChannels = response.coverage.totalChannels;
    const coverageCounts = [
      ["channelsWithCurrentSnapshot", response.coverage.channelsWithCurrentSnapshot],
      ["channelsScanned", response.coverage.channelsScanned],
      [
        "channelsWithCompleteCurrentSnapshot",
        response.coverage.channelsWithCompleteCurrentSnapshot,
      ],
      ["channelsWithCurrentSubscribers", response.coverage.channelsWithCurrentSubscribers],
      ["channelsWithCurrentLifetimeViews", response.coverage.channelsWithCurrentLifetimeViews],
      ["channelsWithCurrentPublicVideos", response.coverage.channelsWithCurrentPublicVideos],
      ["channelsWithBaseline", response.coverage.channelsWithBaseline],
    ] as const;

    for (const [field, count] of coverageCounts) {
      if (count !== undefined && count > totalChannels) {
        context.addIssue({
          code: "custom",
          message: `${field} cannot exceed totalChannels`,
          path: ["coverage", field],
        });
      }
    }

    const validateObservedTotal = (
      metric: { totalChannels: number },
      path: Array<string | number>,
    ) => {
      if (metric.totalChannels !== totalChannels) {
        context.addIssue({
          code: "custom",
          message: "observed totalChannels must match coverage.totalChannels",
          path,
        });
      }
    };

    const validateObservedStrictValue = (
      metric: {
        status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
        value: string | null;
      },
      strictValue: string | null,
      path: Array<string | number>,
    ) => {
      if (metric.status === "COMPLETE") {
        if (strictValue === null || metric.value === null || strictValue !== metric.value) {
          context.addIssue({
            code: "custom",
            message: "COMPLETE observed metrics must match a non-null strict value",
            path,
          });
        }
        return;
      }

      if (strictValue !== null) {
        context.addIssue({
          code: "custom",
          message: "PARTIAL or UNAVAILABLE observed metrics require a null strict value",
          path,
        });
      }
    };

    if (response.observedTotals) {
      validateObservedTotal(response.observedTotals.viewDelta, [
        "observedTotals",
        "viewDelta",
        "totalChannels",
      ]);
      validateObservedTotal(response.observedTotals.subscriberDelta, [
        "observedTotals",
        "subscriberDelta",
        "totalChannels",
      ]);
      validateObservedStrictValue(response.observedTotals.viewDelta, response.totals.viewDelta, [
        "totals",
        "viewDelta",
      ]);
      validateObservedStrictValue(
        response.observedTotals.subscriberDelta,
        response.totals.subscriberDelta,
        ["totals", "subscriberDelta"],
      );
    }

    response.series.forEach((point, index) => {
      if (!point.observed) return;
      validateObservedTotal(point.observed.viewDelta, [
        "series",
        index,
        "observed",
        "viewDelta",
        "totalChannels",
      ]);
      validateObservedTotal(point.observed.subscriberDelta, [
        "series",
        index,
        "observed",
        "subscriberDelta",
        "totalChannels",
      ]);
      validateObservedStrictValue(point.observed.viewDelta, point.viewDelta, [
        "series",
        index,
        "viewDelta",
      ]);
      validateObservedStrictValue(point.observed.subscriberDelta, point.subscriberDelta, [
        "series",
        index,
        "subscriberDelta",
      ]);
    });
  });

export type DashboardTrendPoint = z.infer<typeof DashboardTrendPointSchema>;
export type DashboardTrendResponse = z.infer<typeof DashboardTrendResponseSchema>;
export type DashboardObservedMetric = z.infer<typeof DashboardObservedMetricSchema>;

export const DashboardRevenueStatusSchema = z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]);

interface RevenueCoverageMetric {
  totalEstimatedRevenueUsd: string | null;
  observedEstimatedRevenueUsd: string | null;
  status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
}

function validateRevenueCoverage(
  metric: RevenueCoverageMetric,
  covered: number,
  total: number,
  context: z.core.$RefinementCtx<RevenueCoverageMetric>,
): void {
  if (covered > total) {
    context.addIssue({ code: "custom", message: "covered count cannot exceed total count" });
  }
  if (
    metric.status === "COMPLETE" &&
    (total === 0 ||
      covered !== total ||
      metric.totalEstimatedRevenueUsd === null ||
      metric.observedEstimatedRevenueUsd !== metric.totalEstimatedRevenueUsd)
  ) {
    context.addIssue({
      code: "custom",
      message: "COMPLETE revenue requires a strict value for the entire cohort",
    });
  }
  if (
    metric.status === "PARTIAL" &&
    (covered === 0 ||
      covered >= total ||
      metric.totalEstimatedRevenueUsd !== null ||
      metric.observedEstimatedRevenueUsd === null)
  ) {
    context.addIssue({
      code: "custom",
      message: "PARTIAL revenue exposes only the observed subset",
    });
  }
  if (
    metric.status === "UNAVAILABLE" &&
    (covered !== 0 ||
      metric.totalEstimatedRevenueUsd !== null ||
      metric.observedEstimatedRevenueUsd !== null)
  ) {
    context.addIssue({
      code: "custom",
      message: "UNAVAILABLE revenue must remain null with zero coverage",
    });
  }
}

const DashboardRevenueMetricSchema = z
  .object({
    totalEstimatedRevenueUsd: SignedUsdSchema.nullable(),
    observedEstimatedRevenueUsd: SignedUsdSchema.nullable(),
    status: DashboardRevenueStatusSchema,
    coveredChannelDays: z.number().int().nonnegative(),
    totalChannelDays: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((metric, context) =>
    validateRevenueCoverage(metric, metric.coveredChannelDays, metric.totalChannelDays, context),
  );

export const DashboardRevenuePointSchema = z
  .object({
    date: CalendarDateSchema,
    totalEstimatedRevenueUsd: SignedUsdSchema.nullable(),
    observedEstimatedRevenueUsd: SignedUsdSchema.nullable(),
    status: DashboardRevenueStatusSchema,
    coveredChannels: z.number().int().nonnegative(),
    totalChannels: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((point, context) =>
    validateRevenueCoverage(point, point.coveredChannels, point.totalChannels, context),
  );

export const DashboardRevenueChannelSchema = z
  .object({
    channelId: z.uuid(),
    channelTitle: z.string().min(1),
    monetizationStatus: z.enum(["UNCONFIGURED", "DISABLED", "ENABLED"]),
    effectiveDate: CalendarDateSchema.nullable(),
    rpmUsd: NonnegativeUsdSchema.nullable(),
    lastReviewedAt: TimestampSchema.nullable(),
    totalEstimatedRevenueUsd: SignedUsdSchema.nullable(),
    observedEstimatedRevenueUsd: SignedUsdSchema.nullable(),
    status: DashboardRevenueStatusSchema,
    coveredDays: z.number().int().nonnegative(),
    totalDays: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((channel, context) => {
    validateRevenueCoverage(channel, channel.coveredDays, channel.totalDays, context);
    if (
      channel.monetizationStatus === "ENABLED" &&
      (channel.rpmUsd === null || channel.effectiveDate === null || channel.lastReviewedAt === null)
    ) {
      context.addIssue({ code: "custom", message: "ENABLED monetization requires RPM evidence" });
    }
    if (
      channel.monetizationStatus === "DISABLED" &&
      (channel.rpmUsd !== null || channel.effectiveDate === null || channel.lastReviewedAt === null)
    ) {
      context.addIssue({ code: "custom", message: "DISABLED monetization cannot carry RPM" });
    }
    if (
      channel.monetizationStatus === "UNCONFIGURED" &&
      (channel.rpmUsd !== null ||
        channel.effectiveDate !== null ||
        channel.lastReviewedAt !== null ||
        channel.status !== "UNAVAILABLE")
    ) {
      context.addIssue({
        code: "custom",
        message: "UNCONFIGURED monetization must remain unavailable and evidence-free",
      });
    }
  });

export const DashboardRevenueResponseSchema = z
  .object({
    period: z
      .object({
        startDate: CalendarDateSchema,
        endDate: CalendarDateSchema,
        days: z.number().int().min(1).max(90),
        timeZone: z.string().min(1),
      })
      .strict(),
    currency: z.literal("USD"),
    method: z.literal("PUBLIC_VIEW_DELTA_X_MANUAL_RPM"),
    metric: DashboardRevenueMetricSchema,
    configuredChannels: z.number().int().nonnegative(),
    monetizedChannels: z.number().int().nonnegative(),
    totalChannels: z.number().int().nonnegative(),
    series: z.array(DashboardRevenuePointSchema),
    channels: z.array(DashboardRevenueChannelSchema),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.configuredChannels > response.totalChannels ||
      response.monetizedChannels > response.configuredChannels ||
      response.channels.length !== response.totalChannels
    ) {
      context.addIssue({ code: "custom", message: "channel monetization counts are inconsistent" });
    }
    if (
      response.metric.totalChannelDays !== response.totalChannels * response.period.days ||
      response.series.length !== response.period.days
    ) {
      context.addIssue({
        code: "custom",
        message: "revenue period coverage must match the selected cohort",
      });
    }
  });

export const DailyVideoLeaderSchema = z
  .object({
    rank: z.number().int().positive(),
    channelId: z.uuid(),
    channelTitle: z.string().min(1),
    videoId: z.uuid(),
    youtubeVideoId: z.string().min(1),
    title: z.string().nullable(),
    thumbnail: z.string().nullable(),
    channelViewDelta: SignedIntegerStringSchema.nullable(),
    videoViewDelta: NonnegativeIntegerStringSchema,
    contributionPercent: z.number().nonnegative().nullable(),
    baselineAt: TimestampSchema,
    capturedAt: TimestampSchema,
    status: z.literal("COMPLETE"),
  })
  .strict();

export const DailyVideoLeadersResponseSchema = z
  .object({
    date: CalendarDateSchema,
    previousDate: CalendarDateSchema,
    timeZone: z.string().min(1),
    source: z.literal("YTDLP_CATALOG_SNAPSHOTS"),
    coverageStatus: z.enum(["COMPLETE", "PARTIAL", "WARMING_UP", "UNAVAILABLE"]),
    totalChannels: z.number().int().nonnegative(),
    channelsWithDailyGain: z.number().int().nonnegative(),
    channelsWithComparableCatalog: z.number().int().nonnegative(),
    warnings: z.array(
      z.enum([
        "CATALOG_BASELINE_REQUIRED",
        "CATALOG_COVERAGE_PARTIAL",
        "CHANNEL_DAILY_VIEWS_UNAVAILABLE",
        "NO_POSITIVE_DAILY_GAIN",
      ]),
    ),
    items: z.array(DailyVideoLeaderSchema),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.channelsWithDailyGain > response.totalChannels ||
      response.channelsWithComparableCatalog > response.totalChannels
    ) {
      context.addIssue({
        code: "custom",
        message: "daily leader coverage counts cannot exceed the selected cohort",
      });
    }
  });

export type DashboardRevenueStatus = z.infer<typeof DashboardRevenueStatusSchema>;
export type DashboardRevenuePoint = z.infer<typeof DashboardRevenuePointSchema>;
export type DashboardRevenueChannel = z.infer<typeof DashboardRevenueChannelSchema>;
export type DashboardRevenueResponse = z.infer<typeof DashboardRevenueResponseSchema>;
export type DailyVideoLeader = z.infer<typeof DailyVideoLeaderSchema>;
export type DailyVideoLeadersResponse = z.infer<typeof DailyVideoLeadersResponseSchema>;
