import { z } from "zod";

const boundedText = z.string().trim().min(1).max(4_000);
const boundedList = z.array(z.string().trim().min(1).max(500)).max(30);

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

export const dailyReportSchema = z.object({
  summary: boundedText,
  keyFindings: boundedList.max(20),
  risks: boundedList.max(20),
  opportunities: boundedList.max(20),
  channelsToInspect: z.array(z.string().trim().min(1).max(128)).max(50),
  videosToInspect: z.array(z.string().trim().min(1).max(128)).max(100),
});

export const weeklyReportSchema = z.object({
  executiveSummary: boundedText,
  winners: z
    .array(z.object({ videoId: z.string().trim().min(1).max(128), reason: boundedText.max(1_000) }))
    .max(10),
  emergingPatterns: boundedList.max(20),
  decliningPatterns: boundedList.max(20),
  recommendations: boundedList.max(20),
});

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
