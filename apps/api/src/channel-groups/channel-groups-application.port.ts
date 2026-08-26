import type { UserRoleValue } from "@yt-monitor/auth";
import type { ChannelGroupDetail, ChannelGroupSummary } from "@yt-monitor/shared";

export const CHANNEL_GROUPS_APPLICATION_PORT = Symbol("CHANNEL_GROUPS_APPLICATION_PORT");
export const CHANNEL_ACCESS_RESOLVER = Symbol("CHANNEL_ACCESS_RESOLVER");

export interface ChannelAccessSubject {
  id: string;
  role: UserRoleValue;
}

export interface ChannelAccessResolverPort {
  /** `null` means unrestricted ADMIN access; an empty array means deny all. */
  resolveVisibleChannelIds(subject: ChannelAccessSubject): Promise<string[] | null>;
}

export interface ChannelGroupsApplicationPort extends ChannelAccessResolverPort {
  list(): Promise<{ items: ChannelGroupSummary[] }>;
  listAccessible(input: {
    subject: ChannelAccessSubject;
  }): Promise<{ items: ChannelGroupSummary[] }>;
  get(input: { id: string }): Promise<{ group: ChannelGroupDetail }>;
  create(input: {
    actorUserId: string;
    name: string;
    description: string | null;
  }): Promise<{ group: ChannelGroupDetail }>;
  update(input: {
    actorUserId: string;
    id: string;
    name?: string;
    description?: string | null;
  }): Promise<{ group: ChannelGroupDetail }>;
  archive(input: { actorUserId: string; id: string }): Promise<void>;
  replaceChannels(input: {
    actorUserId: string;
    groupId: string;
    channelIds: string[];
  }): Promise<{ group: ChannelGroupDetail }>;
  replaceViewerGroups(input: {
    actorUserId: string;
    userId: string;
    groupIds: string[];
  }): Promise<void>;
}
