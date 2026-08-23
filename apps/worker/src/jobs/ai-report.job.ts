import {
  dailyReportSchema,
  weeklyReportSchema,
  createAnalysisFingerprint,
  stableJson,
  type AIProvider,
  type DailyReport,
  type WeeklyReport,
} from "@yt-monitor/ai";
import type { ChannelUnitOfWork } from "@yt-monitor/db";

export interface AiReportAggregate {
  kind: "DAILY" | "WEEKLY";
  reportDate: Date;
  channelIds: readonly string[];
  videoIds: readonly string[];
  metricSummary: unknown;
  prompt: string;
}

export type AiReportJobResult =
  | { status: "SKIPPED"; reason: "AI_DISABLED" | "CACHE_HIT" }
  | { status: "SUCCESS"; report: DailyReport | WeeklyReport }
  | { status: "UNAVAILABLE"; code: string };

export class AiReportJob {
  constructor(
    private readonly dependencies: {
      unitOfWork: ChannelUnitOfWork;
      provider: AIProvider;
      model: string | null;
      enabled: boolean;
      now?: () => Date;
    },
  ) {}

  async run(input: AiReportAggregate): Promise<AiReportJobResult> {
    if (!this.dependencies.enabled) return { status: "SKIPPED", reason: "AI_DISABLED" };
    const fingerprint = createAnalysisFingerprint({
      timeRange: `${input.kind}:${input.reportDate.toISOString().slice(0, 10)}`,
      videoIds: input.videoIds,
      metricSummary: { channels: [...input.channelIds].sort(), data: input.metricSummary },
      promptVersion: `phase6-${input.kind.toLowerCase()}-v1`,
    });
    const cached = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.ai.findReport(input.kind, input.reportDate),
    );
    if (cached?.fingerprint === fingerprint) return { status: "SKIPPED", reason: "CACHE_HIT" };
    const started = (this.dependencies.now ?? (() => new Date()))().getTime();
    try {
      const prompt = `${input.prompt}\nAggregate JSON:\n${stableJson(input.metricSummary)}`;
      const report =
        input.kind === "DAILY"
          ? await this.dependencies.provider.structured({
              taskType: "DAILY_REPORT",
              prompt,
              schema: dailyReportSchema,
              ...(this.dependencies.model ? { model: this.dependencies.model } : {}),
              repairOnSchemaError: true,
            })
          : await this.dependencies.provider.structured({
              taskType: "WEEKLY_REPORT",
              prompt,
              schema: weeklyReportSchema,
              ...(this.dependencies.model ? { model: this.dependencies.model } : {}),
              repairOnSchemaError: true,
            });
      await this.dependencies.unitOfWork.transaction(async (repositories) => {
        await repositories.ai.createRun({
          provider: this.dependencies.provider.id,
          modelId: this.dependencies.model ?? "configured",
          taskType: input.kind === "DAILY" ? "DAILY_REPORT" : "WEEKLY_REPORT",
          fingerprint,
          status: "SUCCESS",
          durationMs: (this.dependencies.now ?? (() => new Date()))().getTime() - started,
        });
        await repositories.ai.upsertReport({
          kind: input.kind,
          reportDate: input.reportDate,
          fingerprint,
          provider: this.dependencies.provider.id,
          modelId: this.dependencies.model ?? "configured",
          result: report,
        });
      });
      return { status: "SUCCESS", report };
    } catch (error) {
      const code =
        error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code
          : "AI_UNAVAILABLE";
      await this.dependencies.unitOfWork.transaction((repositories) =>
        repositories.ai.createRun({
          provider: this.dependencies.provider.id,
          modelId: this.dependencies.model ?? "configured",
          taskType: input.kind === "DAILY" ? "DAILY_REPORT" : "WEEKLY_REPORT",
          fingerprint,
          status: "UNAVAILABLE",
          durationMs: (this.dependencies.now ?? (() => new Date()))().getTime() - started,
          errorCode: code,
        }),
      );
      return { status: "UNAVAILABLE", code };
    }
  }
}
