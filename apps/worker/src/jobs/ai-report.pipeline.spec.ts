import type { AIProvider } from "@yt-monitor/ai";
import { describe, expect, it, vi } from "vitest";

import type { AiReportAggregate } from "./ai-report.aggregate.js";
import { AiReportPipeline } from "./ai-report.pipeline.js";

const evidence = {
  id: "channel:channel-1:2026-08-25:view_delta",
  entityType: "CHANNEL" as const,
  entityId: "channel-1",
  metric: "view_delta",
  value: "10",
  unit: "views",
  observedAt: "2026-08-25",
  source: "CHANNEL_DAILY_STAT" as const,
  coverage: "COMPLETE" as const,
  precision: "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS" as const,
  status: "READY" as const,
  reason: null,
};

const aggregate: AiReportAggregate = {
  kind: "DAILY",
  reportDate: new Date("2026-08-25T00:00:00Z"),
  channelIds: ["channel-1"],
  videoIds: [],
  metricSummary: {
    schemaVersion: "canonical-ai-aggregate-v1",
    kind: "DAILY",
    reportDate: "2026-08-25",
    periodStart: "2026-08-25",
    periodEnd: "2026-08-25",
    dataCutoffAt: null,
    coverage: {
      status: "COMPLETE",
      expectedChannelDays: 1,
      observedChannelDays: 1,
      completeChannelDays: 1,
      reason: null,
    },
    channels: [],
    videos: [],
    evidence: [evidence],
  },
};

describe("AiReportPipeline", () => {
  it("records the scheduled job and runs the grounded provider path", async () => {
    const syncRuns = {
      create: vi.fn().mockResolvedValue({ id: "sync-1" }),
      complete: vi.fn().mockResolvedValue({}),
    };
    const ai = {
      findReport: vi.fn().mockResolvedValue(null),
      createRun: vi.fn().mockResolvedValue({}),
      upsertReport: vi.fn().mockResolvedValue({}),
    };
    const repositories = { syncRuns, ai };
    const unitOfWork = {
      transaction: vi.fn(async (work: (input: typeof repositories) => unknown) =>
        work(repositories),
      ),
    } as never;
    const provider = {
      id: "GEMINI",
      structured: vi.fn().mockResolvedValue({
        summary: { text: "Tăng 10 lượt xem.", evidenceIds: [evidence.id] },
        keyFindings: [],
        risks: [],
        opportunities: [],
        limitations: [],
        channelsToInspect: [],
        videosToInspect: [],
      }),
    } as unknown as AIProvider;
    const aggregateBuilder = { build: vi.fn().mockResolvedValue(aggregate) };
    const pipeline = new AiReportPipeline({
      unitOfWork,
      aggregateBuilder: aggregateBuilder as never,
      loadRuntime: vi.fn().mockResolvedValue({ provider, model: null, enabled: true }),
      logger: { info: vi.fn(), warn: vi.fn() } as never,
    });
    const scheduledCutoffAt = new Date("2026-08-25T08:00:00.000Z");
    const result = await pipeline.run("DAILY", aggregate.reportDate, scheduledCutoffAt);
    expect(result.status).toBe("SUCCESS");
    expect(aggregateBuilder.build).toHaveBeenCalledWith(
      "DAILY",
      aggregate.reportDate,
      scheduledCutoffAt,
    );
    expect(syncRuns.create).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: "DAILY_AI_REPORT", status: "RUNNING" }),
    );
    expect(syncRuns.complete).toHaveBeenCalledWith(
      "sync-1",
      expect.objectContaining({ status: "SUCCESS", recordsProcessed: 1 }),
    );
  });
});
