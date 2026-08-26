import type { ChannelGroupAggregateRecord, ChannelUnitOfWork } from "@yt-monitor/db";
import {
  ChannelGroupConflictError,
  ChannelGroupMembershipTargetError,
  ChannelGroupNotFoundError,
} from "@yt-monitor/db";
import type { ChannelGroupDetail, ChannelGroupSummary } from "@yt-monitor/shared";

import { ChannelGroupApplicationError } from "./channel-group-application.error.js";
import type {
  ChannelAccessSubject,
  ChannelGroupsApplicationPort,
} from "./channel-groups-application.port.js";

interface ChannelGroupsServiceDependencies {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  now?: () => Date;
}

function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .replace(/đ/gu, "d")
    .replace(/Đ/gu, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 128);
  if (slug.length === 0) throw ChannelGroupApplicationError.validation();
  return slug;
}

function toSummary(group: ChannelGroupAggregateRecord): ChannelGroupSummary {
  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    description: group.description,
    channelCount: group.channelIds.length,
    viewerCount: group.viewerIds.length,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

function toDetail(group: ChannelGroupAggregateRecord): ChannelGroupDetail {
  return {
    ...toSummary(group),
    channelIds: group.channelIds,
    viewerIds: group.viewerIds,
  };
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof ChannelGroupNotFoundError) throw ChannelGroupApplicationError.notFound();
  if (error instanceof ChannelGroupConflictError)
    throw ChannelGroupApplicationError.alreadyExists();
  if (error instanceof ChannelGroupMembershipTargetError) {
    throw ChannelGroupApplicationError.membershipInvalid();
  }
  throw error;
}

export class ChannelGroupsService implements ChannelGroupsApplicationPort {
  constructor(private readonly dependencies: ChannelGroupsServiceDependencies) {}

  async list(): Promise<{ items: ChannelGroupSummary[] }> {
    const groups = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.channelGroups.listActive(),
    );
    return { items: groups.map(toSummary) };
  }

  async listAccessible(input: {
    subject: ChannelAccessSubject;
  }): Promise<{ items: ChannelGroupSummary[] }> {
    const groups = await this.dependencies.unitOfWork.transaction((repositories) =>
      input.subject.role === "ADMIN"
        ? repositories.channelGroups.listActive()
        : repositories.channelGroups.listAccessibleForUser(input.subject.id),
    );
    return { items: groups.map(toSummary) };
  }

  async get(input: { id: string }): Promise<{ group: ChannelGroupDetail }> {
    const group = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.channelGroups.findActiveById(input.id),
    );
    if (group === null) throw ChannelGroupApplicationError.notFound();
    return { group: toDetail(group) };
  }

  async create(input: {
    actorUserId: string;
    name: string;
    description: string | null;
  }): Promise<{ group: ChannelGroupDetail }> {
    try {
      const group = await this.dependencies.unitOfWork.transaction(async (repositories) => {
        const created = await repositories.channelGroups.create({
          name: input.name,
          slug: slugify(input.name),
          description: input.description,
        });
        await repositories.audit.append({
          actorUserId: input.actorUserId,
          targetUserId: null,
          action: "CHANNEL_GROUP_CREATED",
          outcome: "SUCCESS",
          requestId: null,
          metadata: { channelGroupId: created.id },
        });
        return created;
      });
      return { group: toDetail(group) };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async update(input: {
    actorUserId: string;
    id: string;
    name?: string;
    description?: string | null;
  }): Promise<{ group: ChannelGroupDetail }> {
    try {
      const group = await this.dependencies.unitOfWork.transaction(async (repositories) => {
        const updated = await repositories.channelGroups.update(input.id, {
          ...(input.name === undefined ? {} : { name: input.name, slug: slugify(input.name) }),
          ...(input.description === undefined ? {} : { description: input.description }),
        });
        await repositories.audit.append({
          actorUserId: input.actorUserId,
          targetUserId: null,
          action: "CHANNEL_GROUP_UPDATED",
          outcome: "SUCCESS",
          requestId: null,
          metadata: {
            channelGroupId: updated.id,
            nameChanged: input.name !== undefined,
            descriptionChanged: input.description !== undefined,
          },
        });
        return updated;
      });
      return { group: toDetail(group) };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async archive(input: { actorUserId: string; id: string }): Promise<void> {
    try {
      await this.dependencies.unitOfWork.transaction(async (repositories) => {
        await repositories.channelGroups.archive(
          input.id,
          (this.dependencies.now ?? (() => new Date()))(),
        );
        await repositories.audit.append({
          actorUserId: input.actorUserId,
          targetUserId: null,
          action: "CHANNEL_GROUP_ARCHIVED",
          outcome: "SUCCESS",
          requestId: null,
          metadata: { channelGroupId: input.id },
        });
      });
    } catch (error) {
      mapRepositoryError(error);
    }
  }

  async replaceChannels(input: {
    actorUserId: string;
    groupId: string;
    channelIds: string[];
  }): Promise<{ group: ChannelGroupDetail }> {
    try {
      const group = await this.dependencies.unitOfWork.transaction(async (repositories) => {
        await repositories.channelGroups.replaceChannels(input.groupId, input.channelIds);
        const updated = await repositories.channelGroups.findActiveById(input.groupId);
        if (updated === null) throw new ChannelGroupNotFoundError();
        await repositories.audit.append({
          actorUserId: input.actorUserId,
          targetUserId: null,
          action: "CHANNEL_GROUP_CHANNELS_REPLACED",
          outcome: "SUCCESS",
          requestId: null,
          metadata: { channelGroupId: input.groupId, channelCount: updated.channelIds.length },
        });
        return updated;
      });
      return { group: toDetail(group) };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async replaceViewerGroups(input: {
    actorUserId: string;
    userId: string;
    groupIds: string[];
  }): Promise<void> {
    try {
      await this.dependencies.unitOfWork.transaction(async (repositories) => {
        await repositories.channelGroups.replaceViewerGroups({
          userId: input.userId,
          groupIds: input.groupIds,
          assignedByUserId: input.actorUserId,
        });
        await repositories.audit.append({
          actorUserId: input.actorUserId,
          targetUserId: input.userId,
          action: "VIEWER_CHANNEL_GROUPS_REPLACED",
          outcome: "SUCCESS",
          requestId: null,
          metadata: { groupCount: new Set(input.groupIds).size },
        });
      });
    } catch (error) {
      mapRepositoryError(error);
    }
  }

  resolveVisibleChannelIds(subject: ChannelAccessSubject): Promise<string[] | null> {
    if (subject.role === "ADMIN") return Promise.resolve(null);
    return this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.channelGroups.accessibleChannelIdsForUser(subject.id),
    );
  }
}
