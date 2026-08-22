import {
  transitionChannelHealth,
  type ChannelHealthSignals,
  type ChannelHealthState,
  type SanitizedHealthEvidence,
} from "@yt-monitor/shared";
import type { ChannelRecord, ChannelUnitOfWork } from "@yt-monitor/db";
import type { ChannelHealthSignalStatus } from "@yt-monitor/shared";
import type { PublicHealthCheckResult } from "@yt-monitor/collector-youtube-public";

export interface HealthSignalResult {
  status: ChannelHealthSignalStatus;
  evidence?: SanitizedHealthEvidence;
}

export interface ChannelHealthJobDependencies {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  publicCheck: (channel: ChannelRecord) => Promise<PublicHealthCheckResult>;
  ytdlpCheck: (channel: ChannelRecord) => Promise<HealthSignalResult>;
  rssCheck: (channel: ChannelRecord) => Promise<HealthSignalResult>;
  now?: () => Date;
  circuitOpen?: () => boolean;
}

export interface ChannelHealthJobResult {
  normalizedAvailability: ChannelHealthState["availabilityStatus"];
  deletionConfirmed: boolean;
  retryAt: Date | null;
  signals: ChannelHealthSignals;
}

function fallbackStatus(error: unknown): ChannelHealthSignalStatus {
  if (error instanceof Error && /timeout/iu.test(error.message)) return "TIMEOUT";
  return "NETWORK_ERROR";
}

async function safeSignal(
  callback: () => Promise<HealthSignalResult>,
): Promise<HealthSignalResult> {
  try {
    return await callback();
  } catch (error) {
    return { status: fallbackStatus(error) };
  }
}

async function safePublicCheck(
  callback: () => Promise<PublicHealthCheckResult>,
): Promise<PublicHealthCheckResult> {
  try {
    return await callback();
  } catch (error) {
    const status = fallbackStatus(error);
    return {
      status,
      channelId: null,
      evidence: {
        evidenceCode: status === "TIMEOUT" ? "TIMEOUT" : "NETWORK_ERROR",
        evidenceTextSafe: null,
        httpStatus: null,
        durationMs: 0,
      },
    };
  }
}

export class ChannelHealthJob {
  constructor(private readonly dependencies: ChannelHealthJobDependencies) {}

  async run(channel: ChannelRecord): Promise<ChannelHealthJobResult> {
    const checkedAt = (this.dependencies.now ?? (() => new Date()))();
    const [publicResult, ytdlpResult, rssResult] = await Promise.all([
      safePublicCheck(() => this.dependencies.publicCheck(channel)),
      safeSignal(() => this.dependencies.ytdlpCheck(channel)),
      safeSignal(() => this.dependencies.rssCheck(channel)),
    ]);
    const signals: ChannelHealthSignals = {
      publicPage: publicResult.status,
      ytdlp: ytdlpResult.status,
      rss: rssResult.status,
    };
    const evidence = publicResult.evidence;
    const circuitOpen = this.dependencies.circuitOpen?.() ?? false;
    const transition = circuitOpen
      ? {
          state: {
            availabilityStatus: channel.availabilityStatus,
            activityStatus: channel.activityStatus,
            consecutiveHealthFailures: channel.consecutiveHealthFailures,
            firstUnavailableAt: channel.firstUnavailableAt,
            lastSeenAliveAt: channel.lastSeenAliveAt,
          } satisfies ChannelHealthState,
          normalizedAvailability: channel.availabilityStatus,
          evidenceCode: "PROVIDER_INCIDENT" as const,
          strongFailureCount: 0,
          deletionConfirmed: false,
          retryAt: null,
        }
      : transitionChannelHealth({
          state: {
            availabilityStatus: channel.availabilityStatus,
            activityStatus: channel.activityStatus,
            consecutiveHealthFailures: channel.consecutiveHealthFailures,
            firstUnavailableAt: channel.firstUnavailableAt,
            lastSeenAliveAt: channel.lastSeenAliveAt,
          },
          signals,
          checkedAt,
          evidence,
        });

    await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const queuedHealthRun = await repositories.syncRuns.findQueuedHealth?.(channel.id);
      const syncRun =
        queuedHealthRun ??
        (await repositories.syncRuns.create({
          channelId: channel.id,
          jobType: "CHANNEL_HEALTH",
          status: "RUNNING",
          startedAt: checkedAt,
        }));
      if (queuedHealthRun) {
        await repositories.syncRuns.markRunning?.(syncRun.id, checkedAt);
      }
      await repositories.healthChecks.create({
        channelId: channel.id,
        checkedAt,
        publicPageStatus: signals.publicPage,
        ytdlpStatus: signals.ytdlp,
        rssStatus: signals.rss,
        normalizedAvailability: transition.normalizedAvailability,
        evidenceCode: transition.evidenceCode,
        evidenceTextSafe: circuitOpen ? "YouTube collector degraded" : evidence.evidenceTextSafe,
        httpStatus: evidence.httpStatus,
        durationMs: evidence.durationMs,
      });
      await repositories.channels.updateHealth(channel.id, {
        checkedAt,
        normalizedAvailability: transition.state.availabilityStatus,
        activityStatus: transition.state.activityStatus,
        consecutiveHealthFailures: transition.state.consecutiveHealthFailures,
        firstUnavailableAt: transition.state.firstUnavailableAt,
        lastSeenAliveAt: transition.state.lastSeenAliveAt,
      });
      await repositories.syncRuns.complete(syncRun.id, {
        status: circuitOpen ? "PARTIAL" : "SUCCESS",
        completedAt: checkedAt,
        recordsProcessed: 1,
        errorCode: circuitOpen ? "SYSTEM_PROVIDER_INCIDENT" : null,
        errorMessageSafe: circuitOpen ? "YouTube collector degraded" : null,
      });
    });

    return {
      normalizedAvailability: transition.normalizedAvailability,
      deletionConfirmed: transition.deletionConfirmed,
      retryAt: transition.retryAt,
      signals,
    };
  }
}
