import { z } from "zod";

import { ChannelApplicationError } from "../channels/channel-application.error.js";

export function parseDashboardTrendsQuery(value: unknown): { days: number } {
  const parsed = z
    .object({
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
  return { days };
}
