import { z } from "zod";

import {
  dailyReportSchema,
  weeklyReportSchema,
  type DailyReport,
  type WeeklyReport,
} from "./schemas.js";

export type AiEvidenceEntityType = "PORTFOLIO" | "CHANNEL" | "VIDEO";
export type AiEvidenceCoverage = "COMPLETE" | "PARTIAL";
export type AiEvidencePrecision =
  | "EXACT_AS_PUBLISHED"
  | "ROUNDED_3_SIGNIFICANT_DIGITS"
  | "ROUNDED_PUBLIC_DISPLAY"
  | "DERIVED_FROM_EXACT_PUBLIC_COUNTERS"
  | "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS"
  | "SAMPLE_BASED"
  | "DETERMINISTIC_METADATA"
  | "COVERAGE_RATIO";
export type AiEvidenceStatus = "READY" | "PARTIAL";

export interface AiGroundingEvidence {
  id: string;
  entityType: AiEvidenceEntityType;
  entityId: string | null;
  metric: string;
  value: string;
  unit: string | null;
  observedAt: string;
  source:
    | "CHANNEL_DAILY_STAT"
    | "VIDEO_SNAPSHOT"
    | "DERIVED_CANONICAL_SNAPSHOTS"
    | "PUBLIC_VIDEO_METADATA"
    | "DERIVED_COVERAGE";
  coverage: AiEvidenceCoverage;
  precision: AiEvidencePrecision;
  status: AiEvidenceStatus;
  reason: string | null;
}

export interface AiReportCoverage {
  status: "COMPLETE" | "PARTIAL" | "INSUFFICIENT";
  expectedChannelDays: number;
  observedChannelDays: number;
  completeChannelDays: number;
  reason:
    | "NO_ENABLED_CHANNELS"
    | "NO_CANONICAL_DAILY_STATS"
    | "NO_CANONICAL_METRICS"
    | "INSUFFICIENT_HISTORY"
    | null;
}

export interface ReportGroundingContext {
  coverage: AiReportCoverage;
  evidence: readonly AiGroundingEvidence[];
  channelIds: readonly string[];
  videoIds: readonly string[];
}

export interface GroundedReportEnvelope<T> {
  schemaVersion: "grounded-report-v1";
  report: T;
  grounding: {
    coverage: AiReportCoverage;
    evidence: AiGroundingEvidence[];
  };
}

type GroundedClaim = { text: string; evidenceIds: string[] };

const numericTokenPattern = /[-+]?\d(?:[\d.,]*\d)?%?/gu;

function numericTokens(value: string): string[] {
  return value.match(numericTokenPattern) ?? [];
}

function citesEntity(
  claim: GroundedClaim,
  entityType: "CHANNEL" | "VIDEO",
  entityId: string,
  evidenceById: ReadonlyMap<string, AiGroundingEvidence>,
): boolean {
  return claim.evidenceIds.some((id) => {
    const evidence = evidenceById.get(id);
    return evidence?.entityType === entityType && evidence.entityId === entityId;
  });
}

function evidenceMatchesTarget(
  evidence: AiGroundingEvidence,
  entityType: "CHANNEL" | "VIDEO",
  entityId: string,
): boolean {
  return (
    evidence.entityType === "PORTFOLIO" ||
    (evidence.entityType === entityType && evidence.entityId === entityId)
  );
}

function addTargetGroundingIssues(
  claim: GroundedClaim,
  entityType: "CHANNEL" | "VIDEO",
  entityId: string,
  evidenceById: ReadonlyMap<string, AiGroundingEvidence>,
  refinement: z.RefinementCtx,
): void {
  const referenced = claim.evidenceIds.flatMap((id) => {
    const evidence = evidenceById.get(id);
    return evidence ? [evidence] : [];
  });
  const scopedEvidence = referenced.filter((evidence) =>
    evidenceMatchesTarget(evidence, entityType, entityId),
  );

  for (const evidence of referenced) {
    if (!evidenceMatchesTarget(evidence, entityType, entityId)) {
      refinement.addIssue({
        code: "custom",
        message: `${entityType === "CHANNEL" ? "Channel" : "Video"} target ${entityId} may only cite evidence for that ${entityType.toLowerCase()} or PORTFOLIO evidence`,
      });
    }
  }

  // Re-check numbers against the target-scoped subset. Without this check a claim
  // could cite one harmless same-entity item, then borrow a number from another
  // channel/video and pass the report-wide numeric-token check above.
  const scopedNumbers = new Set(
    scopedEvidence.flatMap((evidence) => numericTokens(evidence.value)),
  );
  for (const token of numericTokens(claim.text)) {
    if (!scopedNumbers.has(token)) {
      refinement.addIssue({
        code: "custom",
        message: `Numeric claim ${token} is not supported by evidence scoped to ${entityType.toLowerCase()} ${entityId}`,
      });
    }
  }
}

function claimsFromReport(report: DailyReport | WeeklyReport): GroundedClaim[] {
  if ("summary" in report) {
    return [
      report.summary,
      ...report.keyFindings,
      ...report.risks,
      ...report.opportunities,
      ...report.limitations,
      ...report.channelsToInspect.map((item) => item.reason),
      ...report.videosToInspect.map((item) => item.reason),
    ];
  }
  return [
    report.executiveSummary,
    ...report.winners.map((item) => item.reason),
    ...report.emergingPatterns,
    ...report.decliningPatterns,
    ...report.recommendations,
    ...report.limitations,
  ];
}

function addGroundingIssues(
  report: DailyReport | WeeklyReport,
  context: ReportGroundingContext,
  refinement: z.RefinementCtx,
): void {
  const evidenceById = new Map(context.evidence.map((evidence) => [evidence.id, evidence]));
  for (const claim of claimsFromReport(report)) {
    const referenced = claim.evidenceIds.flatMap((id) => {
      const evidence = evidenceById.get(id);
      if (!evidence) {
        refinement.addIssue({
          code: "custom",
          message: `Unknown canonical evidence id: ${id}`,
        });
        return [];
      }
      return [evidence];
    });
    const allowedNumbers = new Set(referenced.flatMap((evidence) => numericTokens(evidence.value)));
    for (const token of numericTokens(claim.text)) {
      if (!allowedNumbers.has(token)) {
        refinement.addIssue({
          code: "custom",
          message: `Numeric claim ${token} is not present verbatim in its cited evidence`,
        });
      }
    }
  }

  if (context.coverage.status === "PARTIAL") {
    const coverageEvidenceIds = new Set(
      context.evidence
        .filter(
          (evidence) =>
            evidence.source === "DERIVED_COVERAGE" &&
            evidence.metric === "channelDayCoverage" &&
            evidence.status === "PARTIAL",
        )
        .map((evidence) => evidence.id),
    );
    const hasCoverageGroundedLimitation = report.limitations.some((limitation) =>
      limitation.evidenceIds.some((id) => coverageEvidenceIds.has(id)),
    );
    if (!hasCoverageGroundedLimitation) {
      refinement.addIssue({
        code: "custom",
        path: ["limitations"],
        message: "PARTIAL coverage requires a limitation citing canonical coverage evidence",
      });
    }
  }

  const channelIds = new Set(context.channelIds);
  const videoIds = new Set(context.videoIds);
  if ("summary" in report) {
    for (const target of report.channelsToInspect) {
      if (!channelIds.has(target.channelId)) {
        refinement.addIssue({
          code: "custom",
          message: `Unknown channel target: ${target.channelId}`,
        });
      }
      if (!citesEntity(target.reason, "CHANNEL", target.channelId, evidenceById)) {
        refinement.addIssue({
          code: "custom",
          message: `Channel target ${target.channelId} must cite evidence for that channel`,
        });
      }
      addTargetGroundingIssues(
        target.reason,
        "CHANNEL",
        target.channelId,
        evidenceById,
        refinement,
      );
    }
    for (const target of report.videosToInspect) {
      if (!videoIds.has(target.videoId)) {
        refinement.addIssue({
          code: "custom",
          message: `Unknown video target: ${target.videoId}`,
        });
      }
      if (!citesEntity(target.reason, "VIDEO", target.videoId, evidenceById)) {
        refinement.addIssue({
          code: "custom",
          message: `Video target ${target.videoId} must cite evidence for that video`,
        });
      }
      addTargetGroundingIssues(target.reason, "VIDEO", target.videoId, evidenceById, refinement);
    }
  } else {
    for (const winner of report.winners) {
      if (!videoIds.has(winner.videoId)) {
        refinement.addIssue({
          code: "custom",
          message: `Unknown winning video: ${winner.videoId}`,
        });
      }
      if (!citesEntity(winner.reason, "VIDEO", winner.videoId, evidenceById)) {
        refinement.addIssue({
          code: "custom",
          message: `Winning video ${winner.videoId} must cite evidence for that video`,
        });
      }
      addTargetGroundingIssues(winner.reason, "VIDEO", winner.videoId, evidenceById, refinement);
    }
  }
}

export function createGroundedDailyReportSchema(
  context: ReportGroundingContext,
): z.ZodType<DailyReport> {
  return dailyReportSchema.superRefine((report, refinement) =>
    addGroundingIssues(report, context, refinement),
  );
}

export function createGroundedWeeklyReportSchema(
  context: ReportGroundingContext,
): z.ZodType<WeeklyReport> {
  return weeklyReportSchema.superRefine((report, refinement) =>
    addGroundingIssues(report, context, refinement),
  );
}

export function createGroundedReportEnvelope<T>(input: {
  report: T;
  coverage: AiReportCoverage;
  evidence: readonly AiGroundingEvidence[];
}): GroundedReportEnvelope<T> {
  return {
    schemaVersion: "grounded-report-v1",
    report: input.report,
    grounding: {
      coverage: input.coverage,
      evidence: [...input.evidence],
    },
  };
}
