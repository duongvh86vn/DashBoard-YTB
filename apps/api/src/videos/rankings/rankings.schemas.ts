import { z } from "zod";

import { ChannelApplicationError } from "../../channels/channel-application.error.js";

export function parseRankingQuery(value: unknown): {
  groupId?: string;
  channelId?: string;
  page: number;
  pageSize: number;
} {
  const parsed = z
    .object({
      groupId: z.uuid().optional(),
      channelId: z.uuid().optional(),
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
    })
    .strict()
    .safeParse(value);
  if (!parsed.success) throw ChannelApplicationError.validation();
  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 20;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize) || pageSize > 100) {
    throw ChannelApplicationError.validation();
  }
  return {
    ...(parsed.data.groupId ? { groupId: parsed.data.groupId } : {}),
    ...(parsed.data.channelId ? { channelId: parsed.data.channelId } : {}),
    page,
    pageSize,
  };
}

export function parseSnapshotHistoryQuery(value: unknown): { page: number; pageSize: number } {
  const parsed = z
    .object({
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
    })
    .strict()
    .safeParse(value);
  if (!parsed.success) throw ChannelApplicationError.validation();
  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 20;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize) || pageSize > 100) {
    throw ChannelApplicationError.validation();
  }
  return { page, pageSize };
}

export function parseVideoId(value: string): string {
  if (!z.uuid().safeParse(value).success) throw ChannelApplicationError.validation();
  return value;
}
