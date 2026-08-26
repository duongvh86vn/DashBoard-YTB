import { z } from "zod";

const timestampSchema = z.iso.datetime();

export const ChannelGroupSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(120),
    slug: z.string().min(1).max(128),
    description: z.string().max(1_000).nullable(),
    channelCount: z.number().int().nonnegative(),
    viewerCount: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type ChannelGroupSummary = z.infer<typeof ChannelGroupSummarySchema>;

export const ChannelGroupDetailSchema = ChannelGroupSummarySchema.extend({
  channelIds: z.array(z.uuid()),
  viewerIds: z.array(z.uuid()),
}).strict();

export type ChannelGroupDetail = z.infer<typeof ChannelGroupDetailSchema>;

export const ChannelGroupsResponseSchema = z
  .object({ items: z.array(ChannelGroupSummarySchema) })
  .strict();

export type ChannelGroupsResponse = z.infer<typeof ChannelGroupsResponseSchema>;

export const ChannelGroupResponseSchema = z.object({ group: ChannelGroupDetailSchema }).strict();

export type ChannelGroupResponse = z.infer<typeof ChannelGroupResponseSchema>;
