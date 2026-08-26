import { z } from "zod";

import { ChannelGroupApplicationError } from "./channel-group-application.error.js";

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_000).nullable().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1_000).nullable().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.description !== undefined);

const uniqueIds = z
  .array(z.uuid())
  .max(1_000)
  .refine((values) => new Set(values).size === values.length);
const channelMembershipSchema = z.object({ channelIds: uniqueIds }).strict();
const viewerMembershipSchema = z.object({ groupIds: uniqueIds }).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw ChannelGroupApplicationError.validation();
  return result.data;
}

export function parseChannelGroupId(value: string): string {
  return parse(z.uuid(), value);
}

export function parseCreateChannelGroupBody(value: unknown): {
  name: string;
  description: string | null;
} {
  const parsed = parse(createSchema, value);
  return { name: parsed.name, description: parsed.description ?? null };
}

export function parseUpdateChannelGroupBody(value: unknown): {
  name?: string;
  description?: string | null;
} {
  const parsed = parse(updateSchema, value);
  return {
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
    ...(parsed.description === undefined ? {} : { description: parsed.description }),
  };
}

export function parseReplaceChannelsBody(value: unknown): { channelIds: string[] } {
  return parse(channelMembershipSchema, value);
}

export function parseReplaceViewerGroupsBody(value: unknown): { groupIds: string[] } {
  return parse(viewerMembershipSchema, value);
}
