import type {
  ChannelUnitOfWork,
  ChannelRecord,
  ChannelHealthCheckRecord,
  SyncRunRecord,
} from "@yt-monitor/db";
import { ChannelConflictError, ChannelNotFoundError } from "@yt-monitor/db";
import { ChannelInputError, YtdlpError } from "@yt-monitor/collector-ytdlp";

import { ChannelApplicationError } from "./channel-application.error.js";
import type {
  ChannelsApplicationPort,
  ChannelProviderPort,
  PublicChannel,
  PublicChannelHealthCheck,
  SyncRunsPage,
} from "./channels-application.port.js";

interface ChannelsServiceDependencies {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  provider: ChannelProviderPort;
}

function toPublicChannel(channel: ChannelRecord): PublicChannel {
  return {
    id: channel.id,
    youtubeChannelId: channel.youtubeChannelId,
    originalInput: channel.originalInput,
    canonicalUrl: channel.canonicalUrl,
    handle: channel.handle,
    title: channel.title,
    description: channel.description,
    thumbnail: channel.thumbnail,
    subscriberCount: channel.subscriberCount?.toString() ?? null,
    videoCount: channel.videoCount?.toString() ?? null,
    lifetimeViewCount: channel.lifetimeViewCount?.toString() ?? null,
    lastUploadAt: channel.lastUploadAt?.toISOString() ?? null,
    availabilityStatus: channel.availabilityStatus,
    activityStatus: channel.activityStatus,
    lastChannelScanAt: channel.lastChannelScanAt?.toISOString() ?? null,
    lastHealthCheckAt: channel.lastHealthCheckAt?.toISOString() ?? null,
    lastSeenAliveAt: channel.lastSeenAliveAt?.toISOString() ?? null,
    isEnabled: channel.isEnabled,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
    archivedAt: channel.archivedAt?.toISOString() ?? null,
  };
}

function mapChannelError(error: unknown): never {
  if (error instanceof ChannelConflictError) throw ChannelApplicationError.alreadyExists();
  if (error instanceof ChannelNotFoundError) throw ChannelApplicationError.notFound();
  if (error instanceof ChannelInputError) throw ChannelApplicationError.validation();
  if (error instanceof YtdlpError && error.code === "YTDLP_NOT_FOUND") {
    throw ChannelApplicationError.resolveFailed();
  }
  throw error;
}

function toPublicHealthCheck(check: ChannelHealthCheckRecord): PublicChannelHealthCheck {
  return {
    id: check.id,
    channelId: check.channelId,
    checkedAt: check.checkedAt.toISOString(),
    publicPageStatus: check.publicPageStatus,
    ytdlpStatus: check.ytdlpStatus,
    rssStatus: check.rssStatus,
    normalizedAvailability: check.normalizedAvailability,
    evidenceCode: check.evidenceCode,
    evidenceTextSafe: check.evidenceTextSafe,
    httpStatus: check.httpStatus,
    durationMs: check.durationMs,
    createdAt: check.createdAt.toISOString(),
  };
}

function toPublicSyncRun(run: SyncRunRecord): SyncRunsPage["items"][number] {
  return {
    id: run.id,
    channelId: run.channelId,
    jobType: run.jobType,
    status: run.status,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    recordsProcessed: run.recordsProcessed,
    errorCode: run.errorCode,
    errorMessageSafe: run.errorMessageSafe,
    createdAt: run.createdAt.toISOString(),
  };
}

export class ChannelsService implements ChannelsApplicationPort {
  constructor(private readonly dependencies: ChannelsServiceDependencies) {}

  async list(input: { page: number; pageSize: number }): Promise<{
    items: PublicChannel[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const page = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.channels.list(input),
    );
    return {
      items: page.items.map(toPublicChannel),
      page: input.page,
      pageSize: input.pageSize,
      total: page.total,
    };
  }

  async get(id: string): Promise<PublicChannel> {
    const channel = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.channels.findById(id),
    );
    if (channel === null) throw ChannelApplicationError.notFound();
    return toPublicChannel(channel);
  }

  async create(input: { originalInput: string }): Promise<PublicChannel> {
    let resolved;
    try {
      resolved = await this.dependencies.provider.resolveChannel(input.originalInput);
    } catch (error) {
      if (error instanceof ChannelInputError) throw ChannelApplicationError.validation();
      if (error instanceof YtdlpError) throw ChannelApplicationError.resolveFailed();
      throw error;
    }
    if (resolved === null) throw ChannelApplicationError.resolveFailed();

    try {
      const created = await this.dependencies.unitOfWork.transaction((repositories) =>
        repositories.channels.create({ originalInput: input.originalInput, resolved }),
      );
      return toPublicChannel(created);
    } catch (error) {
      return mapChannelError(error);
    }
  }

  async archive(input: { id: string }): Promise<void> {
    try {
      await this.dependencies.unitOfWork.transaction((repositories) =>
        repositories.channels.archive(input.id, new Date()),
      );
    } catch (error) {
      return mapChannelError(error);
    }
  }

  async requestHealthCheck(input: {
    id: string;
  }): Promise<{ syncRunId: string; status: "QUEUED" }> {
    const syncRun = await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const channel = await repositories.channels.findById(input.id);
      if (channel === null) throw ChannelApplicationError.notFound();
      return repositories.syncRuns.create({
        channelId: input.id,
        jobType: "CHANNEL_HEALTH",
        status: "QUEUED",
      });
    });
    return { syncRunId: syncRun.id, status: "QUEUED" };
  }

  async healthHistory(input: { id: string; page: number; pageSize: number }): Promise<{
    items: PublicChannelHealthCheck[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const result = await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const channel = await repositories.channels.findById(input.id);
      if (channel === null) throw ChannelApplicationError.notFound();
      return repositories.healthChecks.list(input.id, input.page, input.pageSize);
    });
    return {
      items: result.items.map(toPublicHealthCheck),
      page: input.page,
      pageSize: input.pageSize,
      total: result.total,
    };
  }

  async syncRuns(input: { page: number; pageSize: number }): Promise<SyncRunsPage> {
    const result = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.syncRuns.list(input),
    );
    return {
      items: result.items.map(toPublicSyncRun),
      page: input.page,
      pageSize: input.pageSize,
      total: result.total,
    };
  }
}
