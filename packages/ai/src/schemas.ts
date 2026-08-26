import { z } from "zod";

const boundedText = z.string().trim().min(1).max(4_000);
const boundedList = z.array(z.string().trim().min(1).max(500)).max(30);

export const aiEvidenceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[a-z][a-z0-9:_-]*$/u);

export const groundedClaimSchema = z
  .object({
    text: boundedText,
    evidenceIds: z.array(aiEvidenceIdSchema).min(1).max(12),
  })
  .strict();

const channelInspectionSchema = z
  .object({
    channelId: z.string().trim().min(1).max(128),
    reason: groundedClaimSchema,
  })
  .strict();

const videoInspectionSchema = z
  .object({
    videoId: z.string().trim().min(1).max(128),
    reason: groundedClaimSchema,
  })
  .strict();

export const channelClassificationSchema = z.object({
  primaryNiche: boundedText.max(256),
  subNiches: boundedList.max(12),
  language: z.string().trim().min(1).max(32),
  contentFormat: boundedText.max(256),
  confidence: z.number().min(0).max(1),
});

export const videoAnalysisSchema = z.object({
  summary: boundedText,
  topic: boundedText.max(256),
  titlePattern: boundedList.max(12),
  strengths: boundedList.max(20),
  possibleFactors: boundedList.max(20),
  anomalies: boundedList.max(20),
  confidence: z.number().min(0).max(1),
});

export const dailyReportSchema = z
  .object({
    summary: groundedClaimSchema,
    keyFindings: z.array(groundedClaimSchema).max(20),
    risks: z.array(groundedClaimSchema).max(20),
    opportunities: z.array(groundedClaimSchema).max(20),
    limitations: z.array(groundedClaimSchema).max(20),
    channelsToInspect: z.array(channelInspectionSchema).max(50),
    videosToInspect: z.array(videoInspectionSchema).max(100),
  })
  .strict();

export const weeklyReportSchema = z
  .object({
    executiveSummary: groundedClaimSchema,
    winners: z
      .array(
        z
          .object({
            videoId: z.string().trim().min(1).max(128),
            reason: groundedClaimSchema,
          })
          .strict(),
      )
      .max(10),
    emergingPatterns: z.array(groundedClaimSchema).max(20),
    decliningPatterns: z.array(groundedClaimSchema).max(20),
    recommendations: z.array(groundedClaimSchema).max(20),
    limitations: z.array(groundedClaimSchema).max(20),
  })
  .strict();

export const healthAmbiguitySchema = z.object({
  classification: z.enum([
    "LIKELY_ACTIVE",
    "LIKELY_NOT_FOUND",
    "LIKELY_TERMINATED",
    "BLOCK_PAGE",
    "UNKNOWN",
  ]),
  evidence: boundedList.max(10),
  confidence: z.number().min(0).max(1),
});

export type ChannelClassification = z.infer<typeof channelClassificationSchema>;
export type VideoAnalysis = z.infer<typeof videoAnalysisSchema>;
export type DailyReport = z.infer<typeof dailyReportSchema>;
export type WeeklyReport = z.infer<typeof weeklyReportSchema>;
export type HealthAmbiguity = z.infer<typeof healthAmbiguitySchema>;
