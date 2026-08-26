import type { ChannelGroup } from "./generated/prisma/client.js";

export type ChannelGroupRecord = ChannelGroup;

export interface ChannelGroupAggregateRecord extends ChannelGroupRecord {
  channelIds: string[];
  viewerIds: string[];
}
