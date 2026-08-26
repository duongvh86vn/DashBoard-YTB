import { describe, expect, it } from "vitest";

import {
  createGroundedDailyReportSchema,
  createGroundedReportEnvelope,
  createGroundedWeeklyReportSchema,
} from "./grounding.js";
import type { DailyReport } from "./schemas.js";

const context = {
  coverage: {
    status: "COMPLETE" as const,
    expectedChannelDays: 2,
    observedChannelDays: 2,
    completeChannelDays: 2,
    reason: null,
  },
  evidence: [
    {
      id: "channel:channel-1:2026-08-25:view_delta",
      entityType: "CHANNEL" as const,
      entityId: "channel-1",
      metric: "viewDelta",
      value: "1250",
      unit: "views",
      observedAt: "2026-08-25",
      source: "CHANNEL_DAILY_STAT" as const,
      coverage: "COMPLETE" as const,
      precision: "DERIVED_FROM_EXACT_PUBLIC_COUNTERS" as const,
      status: "READY" as const,
      reason: null,
    },
    {
      id: "channel:channel-2:2026-08-25:view_delta",
      entityType: "CHANNEL" as const,
      entityId: "channel-2",
      metric: "viewDelta",
      value: "400",
      unit: "views",
      observedAt: "2026-08-25",
      source: "CHANNEL_DAILY_STAT" as const,
      coverage: "COMPLETE" as const,
      precision: "DERIVED_FROM_EXACT_PUBLIC_COUNTERS" as const,
      status: "READY" as const,
      reason: null,
    },
    {
      id: "video:video-1:2026-08-25:views",
      entityType: "VIDEO" as const,
      entityId: "video-1",
      metric: "views",
      value: "500",
      unit: "views",
      observedAt: "2026-08-25T22:00:00.000Z",
      source: "VIDEO_SNAPSHOT" as const,
      coverage: "COMPLETE" as const,
      precision: "EXACT_AS_PUBLISHED" as const,
      status: "READY" as const,
      reason: null,
    },
    {
      id: "video:video-2:2026-08-25:views",
      entityType: "VIDEO" as const,
      entityId: "video-2",
      metric: "views",
      value: "800",
      unit: "views",
      observedAt: "2026-08-25T22:00:00.000Z",
      source: "VIDEO_SNAPSHOT" as const,
      coverage: "COMPLETE" as const,
      precision: "EXACT_AS_PUBLISHED" as const,
      status: "READY" as const,
      reason: null,
    },
    {
      id: "portfolio:2026-08-25:2026-08-25:coverage",
      entityType: "PORTFOLIO" as const,
      entityId: null,
      metric: "channelDayCoverage",
      value: "1/2",
      unit: "channel-days",
      observedAt: "2026-08-25",
      source: "DERIVED_COVERAGE" as const,
      coverage: "PARTIAL" as const,
      precision: "COVERAGE_RATIO" as const,
      status: "PARTIAL" as const,
      reason: "INCOMPLETE_CHANNEL_DAY_COVERAGE",
    },
  ],
  channelIds: ["channel-1", "channel-2"],
  videoIds: ["video-1", "video-2"],
};

function report(): DailyReport {
  const claim = {
    text: "Kênh tăng 1250 lượt xem.",
    evidenceIds: ["channel:channel-1:2026-08-25:view_delta"],
  };
  return {
    summary: claim,
    keyFindings: [claim],
    risks: [],
    opportunities: [],
    limitations: [],
    channelsToInspect: [{ channelId: "channel-1", reason: claim }],
    videosToInspect: [],
  };
}

describe("grounded AI reports", () => {
  it("accepts claims that cite canonical evidence and copy numeric values verbatim", () => {
    expect(createGroundedDailyReportSchema(context).safeParse(report()).success).toBe(true);
  });

  it("allows a target to cite its own evidence together with portfolio context", () => {
    const candidate = report();
    candidate.channelsToInspect = [
      {
        channelId: "channel-1",
        reason: {
          text: "Kênh tăng 1250 lượt xem khi danh mục chỉ phủ 1/2 ngày-kênh.",
          evidenceIds: [
            "channel:channel-1:2026-08-25:view_delta",
            "portfolio:2026-08-25:2026-08-25:coverage",
          ],
        },
      },
    ];

    expect(createGroundedDailyReportSchema(context).safeParse(candidate).success).toBe(true);
  });

  it("rejects unknown evidence, unknown targets and unsupported numeric claims", () => {
    const candidate = report();
    candidate.summary = {
      text: "Kênh tăng 9999 lượt xem.",
      evidenceIds: ["channel:missing:2026-08-25:view_delta"],
    };
    candidate.channelsToInspect = [{ channelId: "missing-channel", reason: candidate.summary }];
    const parsed = createGroundedDailyReportSchema(context).safeParse(candidate);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Unknown canonical evidence id"),
          expect.stringContaining("Numeric claim 9999"),
          expect.stringContaining("Unknown channel target"),
        ]),
      );
    }
  });

  it("persists deterministic coverage and evidence outside the provider-authored report", () => {
    const envelope = createGroundedReportEnvelope({
      report: report(),
      coverage: {
        status: "COMPLETE",
        expectedChannelDays: 1,
        observedChannelDays: 1,
        completeChannelDays: 1,
        reason: null,
      },
      evidence: context.evidence,
    });
    expect(envelope.schemaVersion).toBe("grounded-report-v1");
    expect(envelope.grounding.evidence).toEqual(context.evidence);
    expect(envelope.grounding.evidence[0]).toMatchObject({
      source: "CHANNEL_DAILY_STAT",
      precision: "DERIVED_FROM_EXACT_PUBLIC_COUNTERS",
      status: "READY",
      reason: null,
    });
  });

  it("rejects inspection reasons that cite a different entity", () => {
    const candidate = report();
    candidate.channelsToInspect = [
      {
        channelId: "channel-1",
        reason: {
          text: "Nên kiểm tra kênh này.",
          evidenceIds: ["channel:channel-2:2026-08-25:view_delta"],
        },
      },
    ];
    candidate.videosToInspect = [
      {
        videoId: "video-1",
        reason: {
          text: "Nên kiểm tra video này.",
          evidenceIds: ["channel:channel-1:2026-08-25:view_delta"],
        },
      },
    ];

    const parsed = createGroundedDailyReportSchema(context).safeParse(candidate);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("must cite evidence for that channel"),
          expect.stringContaining("must cite evidence for that video"),
        ]),
      );
    }
  });

  it("rejects numeric laundering through another channel even when same-channel evidence is cited", () => {
    const candidate = report();
    candidate.channelsToInspect = [
      {
        channelId: "channel-1",
        reason: {
          text: "Kênh tăng 400 lượt xem.",
          evidenceIds: [
            "channel:channel-1:2026-08-25:view_delta",
            "channel:channel-2:2026-08-25:view_delta",
          ],
        },
      },
    ];

    const parsed = createGroundedDailyReportSchema(context).safeParse(candidate);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("may only cite evidence for that channel or PORTFOLIO"),
          expect.stringContaining("Numeric claim 400 is not supported by evidence scoped"),
        ]),
      );
    }
  });

  it("rejects a weekly winner justified only by another entity", () => {
    const claim = {
      text: "Video cần được xem xét.",
      evidenceIds: ["channel:channel-1:2026-08-25:view_delta"],
    };
    const parsed = createGroundedWeeklyReportSchema(context).safeParse({
      executiveSummary: claim,
      winners: [{ videoId: "video-1", reason: claim }],
      emergingPatterns: [],
      decliningPatterns: [],
      recommendations: [],
      limitations: [],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toContain(
        "Winning video video-1 must cite evidence for that video",
      );
    }
  });

  it("rejects numeric laundering through another video in a weekly winner", () => {
    const reason = {
      text: "Video đạt 800 lượt xem.",
      evidenceIds: ["video:video-1:2026-08-25:views", "video:video-2:2026-08-25:views"],
    };
    const parsed = createGroundedWeeklyReportSchema(context).safeParse({
      executiveSummary: {
        text: "Video đạt 500 lượt xem.",
        evidenceIds: ["video:video-1:2026-08-25:views"],
      },
      winners: [{ videoId: "video-1", reason }],
      emergingPatterns: [],
      decliningPatterns: [],
      recommendations: [],
      limitations: [],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("may only cite evidence for that video or PORTFOLIO"),
          expect.stringContaining("Numeric claim 800 is not supported by evidence scoped"),
        ]),
      );
    }
  });

  it.each(["DAILY", "WEEKLY"] as const)(
    "rejects a %s report with PARTIAL coverage and no coverage-grounded limitation",
    (kind) => {
      const partialContext = {
        ...context,
        coverage: {
          status: "PARTIAL" as const,
          expectedChannelDays: 2,
          observedChannelDays: 1,
          completeChannelDays: 1,
          reason: null,
        },
      };
      const candidate =
        kind === "DAILY"
          ? report()
          : {
              executiveSummary: {
                text: "Video đạt 500 lượt xem.",
                evidenceIds: ["video:video-1:2026-08-25:views"],
              },
              winners: [],
              emergingPatterns: [],
              decliningPatterns: [],
              recommendations: [],
              limitations: [],
            };

      const parsed =
        kind === "DAILY"
          ? createGroundedDailyReportSchema(partialContext).safeParse(candidate)
          : createGroundedWeeklyReportSchema(partialContext).safeParse(candidate);

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.map((issue) => issue.message)).toContain(
          "PARTIAL coverage requires a limitation citing canonical coverage evidence",
        );
      }
    },
  );

  it.each(["DAILY", "WEEKLY"] as const)(
    "accepts a %s PARTIAL report with a coverage-grounded limitation",
    (kind) => {
      const partialContext = {
        ...context,
        coverage: {
          status: "PARTIAL" as const,
          expectedChannelDays: 2,
          observedChannelDays: 1,
          completeChannelDays: 1,
          reason: null,
        },
      };
      const limitation = {
        text: "Danh mục chỉ phủ 1/2 ngày-kênh.",
        evidenceIds: ["portfolio:2026-08-25:2026-08-25:coverage"],
      };
      const candidate =
        kind === "DAILY"
          ? { ...report(), limitations: [limitation] }
          : {
              executiveSummary: {
                text: "Video đạt 500 lượt xem.",
                evidenceIds: ["video:video-1:2026-08-25:views"],
              },
              winners: [],
              emergingPatterns: [],
              decliningPatterns: [],
              recommendations: [],
              limitations: [limitation],
            };

      const parsed =
        kind === "DAILY"
          ? createGroundedDailyReportSchema(partialContext).safeParse(candidate)
          : createGroundedWeeklyReportSchema(partialContext).safeParse(candidate);

      expect(parsed.success).toBe(true);
    },
  );
});
