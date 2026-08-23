import type { WorkerHeartbeatRecord } from "@yt-monitor/db";
import { aggregateHealthStatus, type HealthCheck, type HealthResponse } from "@yt-monitor/shared";

export interface DatabaseHealthReader {
  pingDatabase(): Promise<{ latencyMs: number }>;
}

export interface WorkerHeartbeatReader {
  getFreshestRunningHeartbeat(maxAgeSeconds: number): Promise<WorkerHeartbeatRecord | null>;
}

export interface AiHealthReader {
  getAiHealthCheck(): HealthCheck;
}

export interface HealthResult {
  httpStatus: 200 | 503;
  body: HealthResponse;
}

export const DEFAULT_HEALTH_DEPENDENCY_TIMEOUT_MS = 2_000;

export class HealthService {
  constructor(
    private readonly database: DatabaseHealthReader,
    private readonly worker: WorkerHeartbeatReader,
    private readonly version: string,
    private readonly workerStaleSeconds: number,
    private readonly dependencyTimeoutMs = DEFAULT_HEALTH_DEPENDENCY_TIMEOUT_MS,
    private readonly ai?: AiHealthReader,
  ) {}

  async getAggregateHealth(): Promise<HealthResult> {
    const [database, worker] = await Promise.all([this.getDatabaseCheck(), this.getWorkerCheck()]);

    return this.createResult("api", {
      database,
      worker,
      collectors: this.disabledCheck("PHASE_NOT_ENABLED"),
      ai: this.ai?.getAiHealthCheck() ?? this.disabledCheck("AI_DISABLED"),
    });
  }

  async getDatabaseHealth(): Promise<HealthResult> {
    return this.createResult("database", { database: await this.getDatabaseCheck() });
  }

  async getWorkerHealth(): Promise<HealthResult> {
    return this.createResult("worker", { worker: await this.getWorkerCheck() });
  }

  getCollectorsHealth(): HealthResult {
    return this.createResult("collectors", {
      collectors: this.disabledCheck("PHASE_NOT_ENABLED"),
    });
  }

  getAiHealth(): HealthResult {
    return this.createResult("ai", {
      ai: this.ai?.getAiHealthCheck() ?? this.disabledCheck("AI_DISABLED"),
    });
  }

  private async getDatabaseCheck(): Promise<HealthCheck> {
    try {
      const result = await this.withDependencyDeadline(this.database.pingDatabase());
      return { status: "ok", required: true, latencyMs: result.latencyMs };
    } catch {
      return { status: "unavailable", required: true, code: "DATABASE_UNAVAILABLE" };
    }
  }

  private async getWorkerCheck(): Promise<HealthCheck> {
    try {
      const heartbeat = await this.withDependencyDeadline(
        this.worker.getFreshestRunningHeartbeat(this.workerStaleSeconds),
      );
      if (!heartbeat) {
        return { status: "unavailable", required: true, code: "WORKER_HEARTBEAT_STALE" };
      }

      return {
        status: "ok",
        required: true,
        observedAt: heartbeat.lastSeenAt.toISOString(),
        details: { workerId: heartbeat.workerId, version: heartbeat.version },
      };
    } catch {
      return { status: "unavailable", required: true, code: "WORKER_HEALTHCHECK_FAILED" };
    }
  }

  private async withDependencyDeadline<T>(operation: Promise<T>): Promise<T> {
    let deadline: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => {
            reject(new Error("Health dependency deadline exceeded"));
          }, this.dependencyTimeoutMs);
        }),
      ]);
    } finally {
      if (deadline) {
        clearTimeout(deadline);
      }
    }
  }

  private disabledCheck(code: string): HealthCheck {
    return { status: "disabled", required: false, code };
  }

  private createResult(
    service: HealthResponse["service"],
    checks: Record<string, HealthCheck>,
  ): HealthResult {
    const status = aggregateHealthStatus(checks);
    return {
      httpStatus: status === "unavailable" ? 503 : 200,
      body: {
        status,
        service,
        version: this.version,
        timestamp: new Date().toISOString(),
        checks,
      },
    };
  }
}
