import { z } from "zod";

import { ChannelApplicationError } from "./channel-application.error.js";

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

export function parseCreateChannelBody(value: unknown): { channelUrl: string } {
  const parsed = strictObject({ channelUrl: z.string().trim().min(1).max(2_000) }).safeParse(value);
  if (!parsed.success) throw ChannelApplicationError.validation();
  return parsed.data;
}

export function parseListChannelsQuery(value: unknown): { page: number; pageSize: number } {
  const parsed = strictObject({
    page: z
      .string()
      .regex(/^[1-9]\d*$/u)
      .transform(Number)
      .optional(),
    pageSize: z
      .string()
      .regex(/^[1-9]\d*$/u)
      .transform(Number)
      .optional(),
  }).safeParse(value);
  if (!parsed.success) throw ChannelApplicationError.validation();
  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  if (
    !Number.isSafeInteger(page) ||
    !Number.isSafeInteger(pageSize) ||
    pageSize > 100 ||
    !Number.isSafeInteger(offset)
  ) {
    throw ChannelApplicationError.validation();
  }
  return { page, pageSize };
}

export const parseListHealthHistoryQuery = parseListChannelsQuery;
export const parseListSyncRunsQuery = parseListChannelsQuery;

export function parsePublicIntelligenceQuery(value: unknown): { days: number } {
  const parsed = strictObject({
    days: z
      .string()
      .regex(/^[1-9]\d*$/u)
      .transform(Number)
      .optional(),
  }).safeParse(value);
  if (!parsed.success) throw ChannelApplicationError.validation();
  const days = parsed.data.days ?? 30;
  if (!Number.isSafeInteger(days) || days > 90) throw ChannelApplicationError.validation();
  return { days };
}

export function parseChannelId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw ChannelApplicationError.validation();
  }
  return value;
}
