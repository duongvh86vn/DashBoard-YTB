import type { ChannelRepository, VideoCatalogScanRepository } from "@yt-monitor/db";
import type { Logger } from "pino";

import { DailyVideoCatalogJob } from "./daily-catalog.js";

export interface DailyVideoCatalogSchedulerDependencies {
  channels: Pick<ChannelRepository, "listEnabled">;
  scans: Pick<VideoCatalogScanRepository, "findByChannelAndDate">;
  job: Pick<DailyVideoCatalogJob, "run">;
  logger: Pick<Logger, "info" | "warn" | "error">;
  timeZone: string;
  pollMs?: number;
  now?: () => Date;
}

function localParts(now: Date, timeZone: string): { date: string; hour: number; minute: number } {
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

export class DailyVideoCatalogScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly dependencies: DailyVideoCatalogSchedulerDependencies) {}

  start(): void {
    if (this.timer !== null) return;
    void this.runIfDue();
    this.timer = setInterval(() => void this.runIfDue(), this.dependencies.pollMs ?? 30 * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async runIfDue(): Promise<void> {
    if (this.running) return;
    const initial = localParts(
      (this.dependencies.now ?? (() => new Date()))(),
      this.dependencies.timeZone,
    );
    if (initial.hour === 0 && initial.minute < 20) return;

    this.running = true;
    try {
      const channels = await this.dependencies.channels.listEnabled();
      for (const channel of channels) {
        try {
          // A full catalog pass can be long. Re-resolve the local day for each
          // channel so a pass crossing midnight never checks one date and then
          // lets the job persist another. Wait for the new day's 00:20 boundary
          // instead of creating a too-early canonical bucket.
          const current = localParts(
            (this.dependencies.now ?? (() => new Date()))(),
            this.dependencies.timeZone,
          );
          if (current.hour === 0 && current.minute < 20) break;
          const date = new Date(`${current.date}T00:00:00.000Z`);
          const existing = await this.dependencies.scans.findByChannelAndDate(channel.id, date);
          if (existing !== null) continue;
          const result = await this.dependencies.job.run(channel);
          this.dependencies.logger.info(
            { channelId: channel.id, date: current.date, status: result.status },
            "Daily video catalog collected",
          );
        } catch (error) {
          this.dependencies.logger.warn(
            {
              code: "VIDEO_CATALOG_DAILY_FAILED",
              channelId: channel.id,
              errorName: error instanceof Error ? error.name : "UnknownError",
            },
            "Daily video catalog failed safely",
          );
        }
      }
    } catch (error) {
      this.dependencies.logger.error(
        {
          code: "VIDEO_CATALOG_CHANNEL_LIST_FAILED",
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Daily video catalog channel list failed",
      );
    } finally {
      this.running = false;
    }
  }
}
