import { z } from "zod";

import { ChannelApplicationError } from "../channels/channel-application.error.js";

const DashboardSelectionSchema = z
  .object({
    groupId: z.uuid().optional(),
    channelId: z.uuid().optional(),
  })
  .strict();

function optionalSelection(value: {
  groupId?: string | undefined;
  channelId?: string | undefined;
}) {
  return {
    ...(value.groupId === undefined ? {} : { groupId: value.groupId }),
    ...(value.channelId === undefined ? {} : { channelId: value.channelId }),
  };
}

export function parseDashboardTrendsQuery(value: unknown): {
  days: number;
  groupId?: string;
  channelId?: string;
} {
  const parsed = DashboardSelectionSchema.extend({
    days: z
      .string()
      .regex(/^[1-9]\d*$/u)
      .transform(Number)
      .optional(),
  })
    .strict()
    .safeParse(value);
  if (!parsed.success) throw ChannelApplicationError.validation();
  const days = parsed.data.days ?? 28;
  if (!Number.isSafeInteger(days) || days > 90) throw ChannelApplicationError.validation();
  return {
    days,
    ...optionalSelection(parsed.data),
  };
}

export const parseDashboardRevenueQuery = parseDashboardTrendsQuery;

export function parseDailyVideoLeadersQuery(value: unknown): {
  groupId?: string;
  channelId?: string;
} {
  const parsed = DashboardSelectionSchema.safeParse(value);
  if (!parsed.success) throw ChannelApplicationError.validation();
  return optionalSelection(parsed.data);
}
