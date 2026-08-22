import type {
  ChannelRecord,
  ChannelRepository,
  VideoRepository,
  VideoSnapshotRepository,
  VideoRecord,
} from "@yt-monitor/db";
import type { Logger } from "pino";

import { VideoDiscoveryJob } from "./discovery.js";
import { VideoReconcileJob } from "./reconcile.js";
import { VideoSnapshotJob } from "./snapshot.js";
import { shouldCaptureSnapshot } from "./snapshot-bucket.js";
import { tierVideo } from "./tiering.js";

export interface VideoMonitorSchedulerDependencies {
  channels: Pick<ChannelRepository, "listEnabled">;
  videos: Pick<VideoRepository, "listCandidates" | "updateTier">;
  discovery: VideoDiscoveryJob;
  reconcile: VideoReconcileJob;
  snapshots: Pick<VideoSnapshotRepository, "latest">;
  snapshot: VideoSnapshotJob;
  logger: Pick<Logger, "info" | "warn" | "error">;
  rssIntervalMs: number;
  reconcileIntervalMs: number;
  snapshotIntervalMs: number;
  jitterMs?: number;
  now?: () => Date;
}

export class VideoMonitorScheduler {
  private timers: NodeJS.Timeout[] = [];
  private started = false;
  private discoveryRunning = false;
  private reconcileRunning = false;
  private snapshotsRunning = false;

  constructor(private readonly dependencies: VideoMonitorSchedulerDependencies) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.scheduleLoop(() => this.runDiscovery(), this.dependencies.rssIntervalMs);
    this.scheduleLoop(() => this.runReconcile(), this.dependencies.reconcileIntervalMs);
    this.scheduleLoop(() => this.runSnapshots(), this.dependencies.snapshotIntervalMs);
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.started = false;
  }

  private scheduleLoop(work: () => Promise<void>, intervalMs: number): void {
    if (!this.started) return;
    const jitterMs = Math.max(0, this.dependencies.jitterMs ?? Math.min(30_000, intervalMs * 0.1));
    const timer = setTimeout(
      async () => {
        this.timers = this.timers.filter((current) => current !== timer);
        if (!this.started) return;
        try {
          await work();
        } finally {
          this.scheduleLoop(work, intervalMs);
        }
      },
      intervalMs + Math.floor(Math.random() * (jitterMs + 1)),
    );
    timer.unref();
    this.timers.push(timer);
  }

  async runDiscovery(): Promise<void> {
    if (this.discoveryRunning) return;
    this.discoveryRunning = true;
    try {
      await this.runDiscoveryUnlocked();
    } finally {
      this.discoveryRunning = false;
    }
  }

  private async runDiscoveryUnlocked(): Promise<void> {
    let channels: ChannelRecord[];
    try {
      channels = await this.dependencies.channels.listEnabled();
    } catch (error) {
      this.dependencies.logger.error(
        {
          code: "VIDEO_DISCOVERY_LIST_FAILED",
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Video discovery list failed",
      );
      return;
    }
    for (const channel of channels) {
      try {
        const result = await retryOnce(() =>
          this.dependencies.discovery.run(channel, { includeYtdlp: false }),
        );
        this.dependencies.logger.info(
          { channelId: channel.id, discovered: result.discovered },
          "Video discovery completed",
        );
      } catch (error) {
        this.dependencies.logger.warn(
          {
            code: "VIDEO_DISCOVERY_FAILED",
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
          "Video discovery failed safely",
        );
      }
    }
  }

  async runReconcile(): Promise<void> {
    if (this.reconcileRunning) return;
    this.reconcileRunning = true;
    try {
      await this.runReconcileUnlocked();
    } finally {
      this.reconcileRunning = false;
    }
  }

  private async runReconcileUnlocked(): Promise<void> {
    let channels: ChannelRecord[];
    try {
      channels = await this.dependencies.channels.listEnabled();
    } catch (error) {
      this.dependencies.logger.error(
        {
          code: "VIDEO_RECONCILE_LIST_FAILED",
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Video reconcile list failed",
      );
      return;
    }
    for (const channel of channels) {
      const result = await retryOnce(() => this.dependencies.reconcile.run(channel));
      if (result.failed)
        this.dependencies.logger.warn(
          { code: "VIDEO_RECONCILE_FAILED", channelId: channel.id },
          "Video reconcile failed safely",
        );
    }
  }

  async runSnapshots(): Promise<void> {
    if (this.snapshotsRunning) return;
    this.snapshotsRunning = true;
    try {
      await this.runSnapshotsUnlocked();
    } finally {
      this.snapshotsRunning = false;
    }
  }

  private async runSnapshotsUnlocked(): Promise<void> {
    const now = (this.dependencies.now ?? (() => new Date()))();
    let videos: VideoRecord[];
    try {
      videos = await this.dependencies.videos.listCandidates([
        "HOT",
        "WARM",
        "OLD_HOT",
        "PINNED",
        "ARCHIVED",
      ]);
    } catch (error) {
      this.dependencies.logger.error(
        {
          code: "VIDEO_SNAPSHOT_LIST_FAILED",
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Video snapshot list failed",
      );
      return;
    }
    for (const video of videos) {
      const tier = tierVideo({
        publishedAt: video.publishedAt,
        now,
        previousTier: video.monitorTier,
        isPinned: video.isPinned,
        localVph1h: video.vph1h ? Number(video.vph1h) : null,
      }).tier;
      if (tier !== video.monitorTier) {
        try {
          await this.dependencies.videos.updateTier(video.id, tier);
        } catch {
          continue;
        }
      }
      const latest = await this.dependencies.snapshots.latest(video.id);
      if (!shouldCaptureSnapshot(tier, now, latest?.capturedAt ?? null)) continue;
      try {
        await retryOnce(() => this.dependencies.snapshot.run(video));
      } catch (error) {
        this.dependencies.logger.warn(
          {
            code: "VIDEO_SNAPSHOT_FAILED",
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
          "Video snapshot failed safely",
        );
      }
    }
  }
}

async function retryOnce<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (firstError) {
    try {
      return await work();
    } catch {
      throw firstError;
    }
  }
}
