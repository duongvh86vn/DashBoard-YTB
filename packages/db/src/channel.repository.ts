import { CanonicalChannelIdSchema, type ResolvedChannel } from "@yt-monitor/shared";
import { Prisma, type Prisma as PrismaTypes } from "./generated/prisma/client.js";

import type {
  ChannelRecord,
  ChannelSnapshotRecord,
  ChannelSnapshotSourceValue,
} from "./channel-records.js";
import {
  ChannelConflictError,
  ChannelNotFoundError,
  hasPrismaChannelErrorCode,
} from "./channel-errors.js";

type ChannelClient = Pick<
  PrismaTypes.TransactionClient,
  "$executeRaw" | "channel" | "channelSnapshot"
>;

export interface CreateChannelInput {
  originalInput: string;
  resolved: ResolvedChannel;
}

export interface ListChannelsInput {
  page: number;
  pageSize: number;
}

export interface ChannelPage {
  items: ChannelRecord[];
  total: number;
}

export interface CreateChannelSnapshotInput {
  channelId: string;
  capturedAt: Date;
  subscriberCount: bigint | null;
  videoCount: bigint | null;
  lifetimeViewCount: bigint | null;
  lastUploadAt: Date | null;
  source: ChannelSnapshotSourceValue;
  sourceDetails: PrismaTypes.InputJsonValue | null;
}

export interface UpdateChannelHealthInput {
  checkedAt: Date;
  normalizedAvailability:
    | "ACTIVE"
    | "DELETED_OR_TERMINATED"
    | "NOT_FOUND"
    | "TEMPORARILY_UNAVAILABLE"
    | "CHECK_FAILED"
    | "UNKNOWN"
    | "ARCHIVED";
  activityStatus: "ACTIVE_RECENT" | "DORMANT" | "NO_UPLOAD_HISTORY" | "UNKNOWN";
  consecutiveHealthFailures: number;
  firstUnavailableAt: Date | null;
  lastSeenAliveAt: Date | null;
}

function mapChannelMutation<T>(mutation: () => Promise<T>): Promise<T> {
  return mutation().catch((error: unknown) => {
    if (hasPrismaChannelErrorCode(error, "P2002")) throw new ChannelConflictError();
    if (hasPrismaChannelErrorCode(error, "P2025")) throw new ChannelNotFoundError();
    throw error;
  });
}

export class ChannelRepository {
  constructor(private readonly client: ChannelClient) {}

  findById(id: string): Promise<ChannelRecord | null> {
    return this.client.channel.findUnique({ where: { id } });
  }

  findByYoutubeChannelId(youtubeChannelId: string): Promise<ChannelRecord | null> {
    return this.client.channel.findUnique({ where: { youtubeChannelId } });
  }

  async list(input: ListChannelsInput): Promise<ChannelPage> {
    const where = { archivedAt: null } as const;
    const [items, total] = await Promise.all([
      this.client.channel.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.client.channel.count({ where }),
    ]);
    return { items, total };
  }

  listEnabled(): Promise<ChannelRecord[]> {
    return this.client.channel.findMany({
      where: { isEnabled: true, archivedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  latestSnapshot(channelId: string): Promise<ChannelSnapshotRecord | null> {
    return this.client.channelSnapshot.findFirst({
      where: { channelId },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    });
  }

  create(input: CreateChannelInput): Promise<ChannelRecord> {
    const resolved = input.resolved;
    const youtubeChannelId = CanonicalChannelIdSchema.parse(resolved.youtubeChannelId);
    return mapChannelMutation(() =>
      this.client.channel.create({
        data: {
          youtubeChannelId,
          originalInput: input.originalInput,
          canonicalUrl: resolved.canonicalUrl,
          handle: resolved.handle,
          title: resolved.title ?? youtubeChannelId,
          description: resolved.description,
          thumbnail: resolved.thumbnail,
        },
      }),
    );
  }

  archive(id: string, archivedAt: Date): Promise<ChannelRecord> {
    return mapChannelMutation(() =>
      this.client.channel.update({
        where: { id },
        data: { archivedAt, isEnabled: false, availabilityStatus: "ARCHIVED" },
      }),
    );
  }

  updateCurrentStats(
    id: string,
    input: Omit<CreateChannelSnapshotInput, "channelId" | "sourceDetails"> & {
      sourceDetails: PrismaTypes.InputJsonValue | null;
      activityStatus: "ACTIVE_RECENT" | "DORMANT" | "NO_UPLOAD_HISTORY" | "UNKNOWN";
    },
  ): Promise<ChannelRecord> {
    return mapChannelMutation(() =>
      this.client.channel.update({
        where: { id },
        data: {
          subscriberCount: input.subscriberCount,
          videoCount: input.videoCount,
          lifetimeViewCount: input.lifetimeViewCount,
          lastUploadAt: input.lastUploadAt,
          activityStatus: input.activityStatus,
          lastChannelScanAt: input.capturedAt,
          lastSeenAliveAt: input.capturedAt,
        },
      }),
    );
  }

  updateHealth(id: string, input: UpdateChannelHealthInput): Promise<ChannelRecord> {
    return mapChannelMutation(() =>
      this.client.channel.update({
        where: { id },
        data: {
          availabilityStatus: input.normalizedAvailability,
          activityStatus: input.activityStatus,
          lastHealthCheckAt: input.checkedAt,
          lastSeenAliveAt: input.lastSeenAliveAt,
          consecutiveHealthFailures: input.consecutiveHealthFailures,
          firstUnavailableAt: input.firstUnavailableAt,
        },
      }),
    );
  }

  createSnapshot(input: CreateChannelSnapshotInput): Promise<ChannelSnapshotRecord> {
    return mapChannelMutation(() =>
      this.client.channelSnapshot.create({
        data: {
          channelId: input.channelId,
          capturedAt: input.capturedAt,
          subscriberCount: input.subscriberCount,
          videoCount: input.videoCount,
          lifetimeViewCount: input.lifetimeViewCount,
          lastUploadAt: input.lastUploadAt,
          source: input.source,
          sourceDetails: input.sourceDetails ?? Prisma.JsonNull,
        },
      }),
    );
  }
}
