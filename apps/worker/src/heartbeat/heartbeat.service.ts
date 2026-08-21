import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import type { HeartbeatWrite } from "@yt-monitor/db";

export interface HeartbeatWriter {
  upsertHeartbeat(input: HeartbeatWrite): Promise<void>;
}

export type HeartbeatErrorHandler = (error: unknown) => void | Promise<void>;

export const DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS = 2_000;

export class HeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private shuttingDown = false;

  constructor(
    private readonly writer: HeartbeatWriter,
    private readonly workerId: string,
    private readonly version: string,
    private readonly intervalMs: number,
    private readonly onError: HeartbeatErrorHandler = () => undefined,
    private readonly shutdownTimeoutMs = DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.attemptHeartbeat();
    this.scheduleNextHeartbeat();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const inFlight = this.inFlight;
    if (!inFlight) {
      return;
    }

    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        inFlight,
        new Promise<void>((resolve) => {
          deadline = setTimeout(resolve, this.shutdownTimeoutMs);
        }),
      ]);
    } finally {
      if (deadline) {
        clearTimeout(deadline);
      }
    }
  }

  private scheduleNextHeartbeat(): void {
    if (this.shuttingDown) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.runScheduledHeartbeat();
    }, this.intervalMs);
  }

  private async runScheduledHeartbeat(): Promise<void> {
    await this.attemptHeartbeat();
    this.inFlight = undefined;
    this.scheduleNextHeartbeat();
  }

  private async attemptHeartbeat(): Promise<void> {
    try {
      await this.writeHeartbeat();
    } catch (error) {
      try {
        await this.onError(error);
      } catch {
        // Error reporting must never stop the heartbeat retry loop.
      }
    }
  }

  private async writeHeartbeat(): Promise<void> {
    await this.writer.upsertHeartbeat({
      workerId: this.workerId,
      version: this.version,
      status: "RUNNING",
    });
  }
}
