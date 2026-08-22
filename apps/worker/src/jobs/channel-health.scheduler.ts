import type { Logger } from "pino";
import {
  evaluateHealthCircuit,
  type ChannelHealthSignals,
  type CircuitBreakerState,
} from "@yt-monitor/shared";
import type { ChannelRecord, ChannelRepository } from "@yt-monitor/db";

import { ChannelHealthJob } from "./channel-health.job.js";

export interface ChannelHealthSchedulerDependencies {
  channels: Pick<ChannelRepository, "listEnabled">;
  job: ChannelHealthJob;
  logger: Pick<Logger, "info" | "warn" | "error">;
  intervalMs: number;
  now?: () => Date;
  circuitWindow?: HealthCircuitWindow;
}

export class HealthCircuitWindow {
  private readonly recentSignals: ChannelHealthSignals[] = [];

  record(signals: ChannelHealthSignals): void {
    this.recentSignals.push(signals);
    if (this.recentSignals.length > 100) this.recentSignals.shift();
  }

  state(): CircuitBreakerState {
    return evaluateHealthCircuit(this.recentSignals);
  }
}

export class ChannelHealthScheduler {
  private timer: NodeJS.Timeout | undefined;
  constructor(private readonly dependencies: ChannelHealthSchedulerDependencies) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.dependencies.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  circuitState(): CircuitBreakerState {
    return (this.dependencies.circuitWindow ?? EMPTY_CIRCUIT_WINDOW).state();
  }

  async runOnce(): Promise<void> {
    let channels: ChannelRecord[];
    try {
      channels = await this.dependencies.channels.listEnabled();
    } catch (error) {
      this.dependencies.logger.error(
        {
          code: "CHANNEL_HEALTH_LIST_FAILED",
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Channel health list failed",
      );
      return;
    }
    for (const channel of channels) {
      try {
        const result = await this.dependencies.job.run(channel);
        (this.dependencies.circuitWindow ?? EMPTY_CIRCUIT_WINDOW).record(result.signals);
        this.dependencies.logger.info(
          {
            channelId: channel.id,
            availability: result.normalizedAvailability,
            deletionConfirmed: result.deletionConfirmed,
          },
          "Channel health check completed",
        );
      } catch (error) {
        this.dependencies.logger.warn(
          {
            code: "CHANNEL_HEALTH_CHECK_FAILED",
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
          "Channel health check failed safely",
        );
      }
    }
  }
}

const EMPTY_CIRCUIT_WINDOW = new HealthCircuitWindow();
