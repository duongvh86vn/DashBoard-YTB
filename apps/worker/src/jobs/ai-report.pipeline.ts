import type { ChannelUnitOfWork } from "@yt-monitor/db";
import type { Logger } from "pino";

import type { WorkerAiRuntime } from "../ai/runtime.js";
import { AiReportAggregateBuilder } from "./ai-report.aggregate.js";
import { AiReportJob, type AiReportJobResult } from "./ai-report.job.js";

export class AiReportPipeline {
  constructor(
    private readonly dependencies: {
      unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
      aggregateBuilder: AiReportAggregateBuilder;
      loadRuntime: () => Promise<WorkerAiRuntime>;
      logger: Pick<Logger, "info" | "warn">;
      now?: () => Date;
    },
  ) {}

  async run(
    kind: "DAILY" | "WEEKLY",
    reportDate: Date,
    scheduledCutoffAt?: Date,
  ): Promise<AiReportJobResult> {
    const startedAt = this.currentTime();
    const syncRun = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.syncRuns.create({
        jobType: kind === "DAILY" ? "DAILY_AI_REPORT" : "WEEKLY_AI_REPORT",
        status: "RUNNING",
        startedAt,
      }),
    );
    try {
      const [aggregate, runtime] = await Promise.all([
        this.dependencies.aggregateBuilder.build(kind, reportDate, scheduledCutoffAt),
        this.dependencies.loadRuntime(),
      ]);
      const result = await new AiReportJob({
        unitOfWork: this.dependencies.unitOfWork,
        provider: runtime.provider,
        model: runtime.model,
        enabled: runtime.enabled,
        now: () => this.currentTime(),
      }).run(aggregate);
      await this.dependencies.unitOfWork.transaction((repositories) =>
        repositories.syncRuns.complete(syncRun.id, {
          status:
            result.status === "SUCCESS" ||
            (result.status === "SKIPPED" && result.reason === "CACHE_HIT")
              ? "SUCCESS"
              : "PARTIAL",
          completedAt: this.currentTime(),
          recordsProcessed: aggregate.metricSummary.evidence.length,
          errorCode:
            result.status === "UNAVAILABLE"
              ? result.code
              : result.status === "SKIPPED" && result.reason !== "CACHE_HIT"
                ? result.reason
                : null,
        }),
      );
      const logFields = {
        kind,
        reportDate: reportDate.toISOString().slice(0, 10),
        status: result.status,
        ...(result.status === "SKIPPED" ? { reason: result.reason } : {}),
        ...(result.status === "UNAVAILABLE" ? { code: result.code } : {}),
      };
      if (result.status === "SUCCESS") {
        this.dependencies.logger.info(logFields, "Grounded AI report completed");
      } else {
        this.dependencies.logger.warn(logFields, "Grounded AI report did not produce a result");
      }
      return result;
    } catch (error) {
      await this.dependencies.unitOfWork.transaction((repositories) =>
        repositories.syncRuns.complete(syncRun.id, {
          status: "FAILED",
          completedAt: this.currentTime(),
          recordsProcessed: 0,
          errorCode: "AI_REPORT_PIPELINE_FAILED",
          errorMessageSafe: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      this.dependencies.logger.warn(
        {
          code: "AI_REPORT_PIPELINE_FAILED",
          kind,
          reportDate: reportDate.toISOString().slice(0, 10),
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "AI report pipeline failed safely",
      );
      return { status: "UNAVAILABLE", code: "AI_REPORT_PIPELINE_FAILED" };
    }
  }

  private currentTime(): Date {
    return (this.dependencies.now ?? (() => new Date()))();
  }
}
