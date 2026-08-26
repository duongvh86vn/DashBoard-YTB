import type { AIProvider } from "@yt-monitor/ai";
import { describe, expect, it, vi } from "vitest";

import type { AiReportAggregate } from "./ai-report.aggregate.js";
import { AiReportJob } from "./ai-report.job.js";

const evidence = {
  id: "channel:channel-1:2026-08-23:view_delta",
  entityType: "CHANNEL" as const,
  entityId: "channel-1",
  metric: "view_delta",
  value: "10",
  unit: "views",
  observedAt: "2026-08-23",
  source: "CHANNEL_DAILY_STAT" as const,
  coverage: "COMPLETE" as const,
  precision: "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS" as const,
  status: "READY" as const,
  reason: null,
};

function aggregate(
  coverage: "COMPLETE" | "PARTIAL" | "INSUFFICIENT" = "COMPLETE",
): AiReportAggregate {
  return {
    kind: "DAILY",
    reportDate: new Date("2026-08-23T00:00:00.000Z"),
    channelIds: ["channel-1"],
    videoIds: ["video-1"],
    metricSummary: {
      schemaVersion: "canonical-ai-aggregate-v1",
      kind: "DAILY",
      reportDate: "2026-08-23",
      periodStart: "2026-08-23",
      periodEnd: "2026-08-23",
      dataCutoffAt: null,
      coverage: {
        status: coverage,
        expectedChannelDays: 1,
        observedChannelDays: coverage === "INSUFFICIENT" ? 0 : 1,
        completeChannelDays: coverage === "COMPLETE" ? 1 : 0,
        reason: coverage === "INSUFFICIENT" ? "NO_CANONICAL_DAILY_STATS" : null,
      },
      channels: [],
      videos: [],
      evidence: [evidence],
    },
  };
}

const validReport = {
  summary: { text: "Tăng 10 lượt xem.", evidenceIds: [evidence.id] },
  keyFindings: [],
  risks: [],
  opportunities: [],
  limitations: [],
  channelsToInspect: [],
  videosToInspect: [],
};

describe("AiReportJob", () => {
  it("keeps AI disabled explicit and does not call provider", async () => {
    const provider = { structured: vi.fn(), id: "GEMINI" } as unknown as AIProvider;
    const uow = { transaction: vi.fn() };
    const result = await new AiReportJob({
      unitOfWork: uow as never,
      provider,
      model: null,
      enabled: false,
    }).run(aggregate());
    expect(result).toEqual({ status: "SKIPPED", reason: "AI_DISABLED" });
    expect(provider.structured).not.toHaveBeenCalled();
  });

  it("does not call AI or persist a report when canonical history is insufficient", async () => {
    const provider = { structured: vi.fn(), id: "GEMINI" } as unknown as AIProvider;
    const uow = { transaction: vi.fn() };
    const result = await new AiReportJob({
      unitOfWork: uow as never,
      provider,
      model: null,
      enabled: true,
    }).run(aggregate("INSUFFICIENT"));
    expect(result).toEqual({ status: "SKIPPED", reason: "INSUFFICIENT_DATA" });
    expect(provider.structured).not.toHaveBeenCalled();
    expect(uow.transaction).not.toHaveBeenCalled();
  });

  it("persists only a schema-valid grounded envelope", async () => {
    const provider = {
      id: "GEMINI",
      lastModelId: "gemini-effective-model",
      structured: vi.fn().mockResolvedValue(validReport),
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
      model: null,
      enabled: true,
    }).run(aggregate());
    expect(result.status).toBe("SUCCESS");
    if (result.status === "SUCCESS") {
      expect(result.report).toMatchObject({
        schemaVersion: "grounded-report-v1",
        report: validReport,
        grounding: { evidence: [evidence] },
      });
    }
    expect(repositories.ai.upsertReport).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "gemini-effective-model",
        result: expect.objectContaining({ schemaVersion: "grounded-report-v1" }),
      }),
    );
    expect(repositories.ai.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "gemini-effective-model", provider: "GEMINI" }),
    );
  });

  it("rejects a provider result containing an uncited numeric claim", async () => {
    const provider = {
      id: "GEMINI",
      structured: vi.fn().mockResolvedValue({
        ...validReport,
        summary: { text: "Tăng 999 lượt xem.", evidenceIds: [evidence.id] },
      }),
    } as unknown as AIProvider;
    const repositories = {
      ai: {
        findReport: vi.fn().mockResolvedValue(null),
        createRun: vi.fn().mockResolvedValue({}),
        upsertReport: vi.fn().mockResolvedValue({}),
      },
    };
    const uow = {
      transaction: vi.fn(async (work: (input: typeof repositories) => unknown) =>
        work(repositories),
      ),
    } as never;
    const result = await new AiReportJob({
      unitOfWork: uow,
      provider,
      model: "model",
      enabled: true,
    }).run(aggregate());
    expect(result).toEqual({ status: "UNAVAILABLE", code: "AI_SCHEMA_INVALID" });
    expect(repositories.ai.upsertReport).not.toHaveBeenCalled();
    expect(repositories.ai.createRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "SCHEMA_INVALID", errorCode: "AI_SCHEMA_INVALID" }),
    );
  });

  it("rejects a PARTIAL provider report that omits a coverage-grounded limitation", async () => {
    const coverageEvidence = {
      id: "portfolio:2026-08-23:2026-08-23:coverage",
      entityType: "PORTFOLIO" as const,
      entityId: null,
      metric: "channelDayCoverage",
      value: "1/1",
      unit: "channel-days",
      observedAt: "2026-08-23",
      source: "DERIVED_COVERAGE" as const,
      coverage: "PARTIAL" as const,
      precision: "COVERAGE_RATIO" as const,
      status: "PARTIAL" as const,
      reason: "INCOMPLETE_CHANNEL_DAY_COVERAGE",
    };
    const input = aggregate("PARTIAL");
    input.metricSummary.evidence.push(coverageEvidence);
    const provider = {
      id: "GEMINI",
      structured: vi.fn().mockResolvedValue(validReport),
    } as unknown as AIProvider;
    const repositories = {
      ai: {
        findReport: vi.fn().mockResolvedValue(null),
        createRun: vi.fn().mockResolvedValue({}),
        upsertReport: vi.fn().mockResolvedValue({}),
      },
    };
    const uow = {
      transaction: vi.fn(async (work: (input: typeof repositories) => unknown) =>
        work(repositories),
      ),
    } as never;

    const result = await new AiReportJob({
      unitOfWork: uow,
      provider,
      model: "model",
      enabled: true,
    }).run(input);

    expect(result).toEqual({ status: "UNAVAILABLE", code: "AI_SCHEMA_INVALID" });
    expect(repositories.ai.upsertReport).not.toHaveBeenCalled();
  });

  it("keeps a scheduled occurrence idempotent when post-cutoff source metadata drifts", async () => {
    let persistedFingerprint: string | null = null;
    const provider = {
      id: "GEMINI",
      structured: vi.fn().mockResolvedValue(validReport),
    } as unknown as AIProvider;
    const repositories = {
      ai: {
        findReport: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(persistedFingerprint ? { fingerprint: persistedFingerprint } : null),
          ),
        createRun: vi.fn().mockResolvedValue({}),
        upsertReport: vi.fn().mockImplementation((input: { fingerprint: string }) => {
          persistedFingerprint = input.fingerprint;
          return Promise.resolve({});
        }),
      },
    };
    const uow = {
      transaction: vi.fn(async (work: (input: typeof repositories) => unknown) =>
        work(repositories),
      ),
    } as never;
    const job = new AiReportJob({
      unitOfWork: uow,
      provider,
      model: "model",
      enabled: true,
    });
    const first = aggregate();
    first.metricSummary.dataCutoffAt = "2026-08-23T01:00:00.000Z";

    await expect(job.run(first)).resolves.toMatchObject({ status: "SUCCESS" });

    const retry = aggregate();
    retry.metricSummary.dataCutoffAt = "2026-08-23T01:00:00.000Z";
    retry.channelIds = ["channel-1", "channel-discovered-after-cutoff"];
    retry.videoIds = ["video-discovered-after-cutoff"];
    retry.metricSummary.channels = [
      {
        channelId: "channel-discovered-after-cutoff",
        title: "Changed after cutoff",
        observedDays: 0,
        completeDays: 0,
        latestSubscriberCount: null,
        latestVideoCount: null,
        latestLifetimeViewCount: null,
        periodSubscriberDelta: null,
        periodVideoDelta: null,
        periodViewDelta: null,
      },
    ];

    await expect(job.run(retry)).resolves.toEqual({ status: "SKIPPED", reason: "CACHE_HIT" });
    expect(provider.structured).toHaveBeenCalledTimes(1);
    expect(repositories.ai.upsertReport).toHaveBeenCalledTimes(1);
  });
});
