import { z } from "zod";

const SignedIntegerStringSchema = z.string().regex(/^-?\d+$/u);
const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

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
