import { z } from "zod";

import { ChannelApplicationError } from "../channels/channel-application.error.js";

export function parseUuid(value: string): string {
  if (!z.uuid().safeParse(value).success) throw ChannelApplicationError.validation();
  return value;
}

export function parseVideosQuery(value: unknown): { page: number; pageSize: number } {
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
  const pageSize = parsed.data.pageSize ?? 50;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize) || pageSize > 100) {
    throw ChannelApplicationError.validation();
  }
  return { page, pageSize };
}
