import type { ChannelRecord, ChannelRepository } from "@yt-monitor/db";
import type { Logger } from "pino";

import { ChannelStatsJob } from "./channel-stats.job.js";
import { DailyFinalizeJob } from "./daily-finalize.job.js";

export interface ChannelDataSchedulerDependencies {
  channels: Pick<ChannelRepository, "listEnabled">;
  stats: ChannelStatsJob;
  daily: DailyFinalizeJob;
  logger: Pick<Logger, "info" | "warn" | "error">;
  statsIntervalMs: number;
  timeZone: string;
  bootstrapPollMs?: number;
  initialRetryMs?: number;
  dailyPollMs?: number;
  now?: () => Date;
}

type StatsPass = "INITIAL" | "SCHEDULED" | "DAILY_FRESH";

function localParts(
  now: Date,
  timeZone: string,
): {
  date: string;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

/**
 * Runs the Phase 2 channel data jobs that were previously defined but not wired
 * into the worker lifecycle. Uninitialized channels get a bounded fast-path so
 * a channel added after worker startup does not wait for the six-hour cadence.
 */
export class ChannelDataScheduler {
  private timers: NodeJS.Timeout[] = [];
  private started = false;
  private running = false;
  private lastDailyDate: string | null = null;
  private readonly initialAttempts = new Map<string, number>();

  constructor(private readonly dependencies: ChannelDataSchedulerDependencies) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.runInitialStatsOnce();
    void this.runDailyIfDue();
    this.addInterval(() => this.runInitialStatsOnce(), this.dependencies.bootstrapPollMs ?? 30_000);
    this.addInterval(() => this.runScheduledStatsOnce(), this.dependencies.statsIntervalMs);
    this.addInterval(() => this.runDailyIfDue(), this.dependencies.dailyPollMs ?? 30_000);
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.started = false;
  }

  private addInterval(work: () => Promise<void>, intervalMs: number): void {
    const timer = setInterval(() => void work(), intervalMs);
    timer.unref();
    this.timers.push(timer);
  }

  async runInitialStatsOnce(): Promise<void> {
    await this.withLock(async () => {
      const now = this.currentTime();
      const retryMs = this.dependencies.initialRetryMs ?? 15 * 60_000;
      const channels = (await this.listChannels()).filter((channel) => {
        if (channel.lastChannelScanAt !== null) {
          this.initialAttempts.delete(channel.id);
          return false;
        }
        const attemptedAt = this.initialAttempts.get(channel.id);
        return attemptedAt === undefined || now.getTime() - attemptedAt >= retryMs;
      });
      for (const channel of channels) {
        this.initialAttempts.set(channel.id, now.getTime());
        const status = await this.runStats(channel, "INITIAL");
        if (status === "SUCCESS") this.initialAttempts.delete(channel.id);
      }
    });
  }

  async runScheduledStatsOnce(): Promise<void> {
    await this.withLock(async () => {
      for (const channel of await this.listChannels()) {
        await this.runStats(channel, "SCHEDULED");
      }
    });
  }

  async runDailyIfDue(): Promise<void> {
    const current = localParts(this.currentTime(), this.dependencies.timeZone);
    if (!isPastDailyBoundary(current) || this.lastDailyDate === current.date) return;
    await this.withLock(async () => {
      const fresh = localParts(this.currentTime(), this.dependencies.timeZone);
      if (!isPastDailyBoundary(fresh) || this.lastDailyDate === fresh.date) return;
      const channels: ChannelRecord[] = [];
      for (const channel of await this.listChannels()) {
        if (await this.dependencies.daily.needsFinalization(channel.id)) channels.push(channel);
      }
      if (channels.length === 0) {
        this.lastDailyDate = fresh.date;
        return;
      }
      const freshResults = new Map<string, "SUCCESS" | "PARTIAL">();
      for (const channel of channels) {
        freshResults.set(channel.id, await this.runStats(channel, "DAILY_FRESH"));
      }

      // Re-read after collection so daily rows contain the just-persisted current values.
      let failed = false;
      const pendingIds = new Set(channels.map((channel) => channel.id));
      for (const channel of await this.listChannels()) {
        if (!pendingIds.has(channel.id)) continue;
        try {
          await this.dependencies.daily.run(channel, {
            freshCollectionSucceeded: freshResults.get(channel.id) === "SUCCESS",
          });
          this.dependencies.logger.info(
            { channelId: channel.id, date: fresh.date },
            "Channel daily metrics finalized",
          );
        } catch (error) {
          failed = true;
          this.dependencies.logger.warn(
            {
              code: "CHANNEL_DAILY_FINALIZE_FAILED",
              channelId: channel.id,
              errorName: error instanceof Error ? error.name : "UnknownError",
            },
            "Channel daily finalize failed safely",
          );
        }
      }
      if (!failed) this.lastDailyDate = fresh.date;
    });
  }

  private async runStats(channel: ChannelRecord, pass: StatsPass): Promise<"SUCCESS" | "PARTIAL"> {
    try {
      const status = await this.dependencies.stats.run(channel);
      const fields = { channelId: channel.id, pass, status };
      if (status === "SUCCESS") {
        this.dependencies.logger.info(fields, "Channel current metrics collected");
      } else {
        this.dependencies.logger.warn(fields, "Channel current metrics remain partial");
      }
      return status;
    } catch (error) {
      this.dependencies.logger.warn(
        {
          code: "CHANNEL_CURRENT_STATS_FAILED",
          channelId: channel.id,
          pass,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Channel current metrics failed safely",
      );
      return "PARTIAL";
    }
  }

  private async listChannels(): Promise<ChannelRecord[]> {
    try {
      return await this.dependencies.channels.listEnabled();
    } catch (error) {
      this.dependencies.logger.error(
        {
          code: "CHANNEL_DATA_LIST_FAILED",
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Channel data list failed",
      );
      throw error;
    }
  }

  private currentTime(): Date {
    return (this.dependencies.now ?? (() => new Date()))();
  }

  private async withLock(work: () => Promise<void>): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await work();
    } catch {
      // listChannels already emitted a safe diagnostic; the next interval retries.
    } finally {
      this.running = false;
    }
  }
}

function isPastDailyBoundary(value: { hour: number; minute: number }): boolean {
  return value.hour > 0 || (value.hour === 0 && value.minute >= 10);
}

export function localCalendarDate(now: Date, timeZone: string): string {
  return localParts(now, timeZone).date;
}
