import { z } from "zod";

const SignedIntegerStringSchema = z.string().regex(/^-?\d+$/u);
const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const DashboardTrendPointSchema = z.object({
  date: CalendarDateSchema,
  viewDelta: SignedIntegerStringSchema.nullable(),
  subscriberDelta: SignedIntegerStringSchema.nullable(),
  publishedVideos: z.number().int().nonnegative(),
  hasSnapshot: z.boolean(),
});

export const DashboardTrendResponseSchema = z.object({
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
  coverage: z.object({
    totalChannels: z.number().int().nonnegative(),
    channelsWithCurrentSnapshot: z.number().int().nonnegative(),
    channelsWithBaseline: z.number().int().nonnegative(),
    requestedDays: z.number().int().min(1).max(90),
    completeDays: z.number().int().nonnegative(),
    partialDays: z.number().int().nonnegative(),
    coveragePercent: z.number().min(0).max(100),
  }),
  series: z.array(DashboardTrendPointSchema),
});

export type DashboardTrendPoint = z.infer<typeof DashboardTrendPointSchema>;
export type DashboardTrendResponse = z.infer<typeof DashboardTrendResponseSchema>;
