import type { Prisma } from "./generated/prisma/client.js";

import {
  ChannelGroupConflictError,
  ChannelGroupMembershipTargetError,
  ChannelGroupNotFoundError,
} from "./channel-group-errors.js";
import type { ChannelGroupAggregateRecord } from "./channel-group-records.js";

type ChannelGroupClient = Pick<
  Prisma.TransactionClient,
  "channel" | "channelGroup" | "channelGroupChannel" | "user" | "userChannelGroup"
>;

export interface CreateChannelGroupInput {
  name: string;
  slug: string;
  description: string | null;
}

export interface UpdateChannelGroupInput {
  name?: string;
  slug?: string;
  description?: string | null;
}

interface SelectedChannelGroup {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  channelMemberships: Array<{ channelId: string }>;
  userMemberships: Array<{ userId: string }>;
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function toAggregate(group: SelectedChannelGroup): ChannelGroupAggregateRecord {
  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    description: group.description,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    archivedAt: group.archivedAt,
    channelIds: group.channelMemberships.map((membership) => membership.channelId),
    viewerIds: group.userMemberships.map((membership) => membership.userId),
  };
}

export class ChannelGroupRepository {
  constructor(private readonly client: ChannelGroupClient) {}

  private findSelectedById(id: string) {
    return this.client.channelGroup.findFirst({
      where: { id, archivedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        archivedAt: true,
        channelMemberships: {
          where: { channel: { archivedAt: null } },
          select: { channelId: true },
          orderBy: { channelId: "asc" },
        },
        userMemberships: {
          select: { userId: true },
          orderBy: { userId: "asc" },
        },
      },
    });
  }

  async listActive(): Promise<ChannelGroupAggregateRecord[]> {
    const groups = await this.client.channelGroup.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        archivedAt: true,
        channelMemberships: {
          where: { channel: { archivedAt: null } },
          select: { channelId: true },
          orderBy: { channelId: "asc" },
        },
        userMemberships: {
          select: { userId: true },
          orderBy: { userId: "asc" },
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return groups.map(toAggregate);
  }

  async listAccessibleForUser(userId: string): Promise<ChannelGroupAggregateRecord[]> {
    const groups = await this.client.channelGroup.findMany({
      where: { archivedAt: null, userMemberships: { some: { userId } } },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        archivedAt: true,
        channelMemberships: {
          where: { channel: { archivedAt: null } },
          select: { channelId: true },
          orderBy: { channelId: "asc" },
        },
        userMemberships: {
          select: { userId: true },
          orderBy: { userId: "asc" },
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return groups.map(toAggregate);
  }

  async findActiveById(id: string): Promise<ChannelGroupAggregateRecord | null> {
    const group = await this.findSelectedById(id);
    return group === null ? null : toAggregate(group);
  }

  async create(input: CreateChannelGroupInput): Promise<ChannelGroupAggregateRecord> {
    try {
      const created = await this.client.channelGroup.create({ data: input, select: { id: true } });
      const group = await this.findSelectedById(created.id);
      if (group === null) throw new ChannelGroupNotFoundError();
      return toAggregate(group);
    } catch (error) {
      if (hasPrismaCode(error, "P2002")) throw new ChannelGroupConflictError();
      throw error;
    }
  }

  async update(id: string, input: UpdateChannelGroupInput): Promise<ChannelGroupAggregateRecord> {
    if ((await this.findSelectedById(id)) === null) throw new ChannelGroupNotFoundError();
    try {
      await this.client.channelGroup.update({ where: { id }, data: input });
      const group = await this.findSelectedById(id);
      if (group === null) throw new ChannelGroupNotFoundError();
      return toAggregate(group);
    } catch (error) {
      if (hasPrismaCode(error, "P2002")) throw new ChannelGroupConflictError();
      if (hasPrismaCode(error, "P2025")) throw new ChannelGroupNotFoundError();
      throw error;
    }
  }

  async archive(id: string, archivedAt: Date): Promise<void> {
    const result = await this.client.channelGroup.updateMany({
      where: { id, archivedAt: null },
      data: { archivedAt },
    });
    if (result.count !== 1) throw new ChannelGroupNotFoundError();
  }

  async replaceChannels(groupId: string, channelIds: readonly string[]): Promise<void> {
    if ((await this.findSelectedById(groupId)) === null) throw new ChannelGroupNotFoundError();
    const uniqueIds = [...new Set(channelIds)];
    const validCount = await this.client.channel.count({
      where: { id: { in: uniqueIds }, archivedAt: null },
    });
    if (validCount !== uniqueIds.length) {
      throw new ChannelGroupMembershipTargetError("CHANNEL");
    }

    await this.client.channelGroupChannel.deleteMany({ where: { groupId } });
    if (uniqueIds.length > 0) {
      await this.client.channelGroupChannel.createMany({
        data: uniqueIds.map((channelId) => ({ groupId, channelId })),
      });
    }
  }

  async replaceViewerGroups(input: {
    userId: string;
    groupIds: readonly string[];
    assignedByUserId: string;
  }): Promise<void> {
    const viewer = await this.client.user.findFirst({
      where: { id: input.userId, role: "VIEWER" },
      select: { id: true },
    });
    if (viewer === null) throw new ChannelGroupMembershipTargetError("VIEWER");

    const uniqueIds = [...new Set(input.groupIds)];
    const validCount = await this.client.channelGroup.count({
      where: { id: { in: uniqueIds }, archivedAt: null },
    });
    if (validCount !== uniqueIds.length) {
      throw new ChannelGroupMembershipTargetError("GROUP");
    }

    await this.client.userChannelGroup.deleteMany({ where: { userId: input.userId } });
    if (uniqueIds.length > 0) {
      await this.client.userChannelGroup.createMany({
        data: uniqueIds.map((groupId) => ({
          userId: input.userId,
          groupId,
          assignedByUserId: input.assignedByUserId,
        })),
      });
    }
  }

  async accessibleChannelIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.client.channelGroupChannel.findMany({
      where: {
        channel: { archivedAt: null },
        group: {
          archivedAt: null,
          userMemberships: { some: { userId } },
        },
      },
      select: { channelId: true },
      distinct: ["channelId"],
      orderBy: { channelId: "asc" },
    });
    return rows.map((row) => row.channelId);
  }
}
