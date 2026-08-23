import { describe, expect, it, vi } from "vitest";
import { dailyReportSchema, type AIProvider } from "@yt-monitor/ai";
import { AiReportJob } from "./ai-report.job.js";

const aggregate = {
  kind: "DAILY" as const,
  reportDate: new Date("2026-08-23T00:00:00.000Z"),
  channelIds: ["channel-1"],
  videoIds: ["video-1"],
  metricSummary: { viewsDelta: 10 },
  prompt: "Summarize",
};

describe("AiReportJob", () => {
  it("keeps AI disabled explicit and does not call provider", async () => {
    const provider = { structured: vi.fn(), id: "GEMINI" } as unknown as AIProvider;
    const uow = { transaction: vi.fn() } as never;
    const result = await new AiReportJob({
      unitOfWork: uow,
      provider,
      model: null,
      enabled: false,
    }).run(aggregate);
    expect(result).toEqual({ status: "SKIPPED", reason: "AI_DISABLED" });
    expect(provider.structured).not.toHaveBeenCalled();
  });

  it("persists only schema-valid structured output", async () => {
    const provider = {
      id: "GEMINI",
      structured: vi.fn().mockResolvedValue({
        summary: "ok",
        keyFindings: [],
        risks: [],
        opportunities: [],
        channelsToInspect: [],
        videosToInspect: [],
      }),
    } as unknown as AIProvider;
    const repositories = {
      ai: {
        findReport: vi.fn().mockResolvedValue(null),
        createRun: vi.fn().mockResolvedValue({}),
        upsertReport: vi.fn().mockResolvedValue({}),
      },
    };
    type Repositories = typeof repositories;
    const uow = {
      transaction: vi.fn(async (work: (input: Repositories) => unknown) => work(repositories)),
    } as never;
    const result = await new AiReportJob({
      unitOfWork: uow,
      provider,
      model: "model",
      enabled: true,
    }).run(aggregate);
    expect(result.status).toBe("SUCCESS");
    expect(dailyReportSchema.safeParse((result as { report: unknown }).report).success).toBe(true);
    expect(repositories.ai.upsertReport).toHaveBeenCalledTimes(1);
  });
});
