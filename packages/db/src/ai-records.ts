import type {
  AiChannelClassification,
  AiModelRole,
  AiProvider,
  AiProviderSetting,
  AiReport,
  AiReportKind,
  AiRun,
  AiRunStatus,
  AiTaskType,
  AiVideoAnalysis,
} from "./generated/prisma/client.js";

export type AiProviderValue = AiProvider;
export type AiModelRoleValue = AiModelRole;
export type AiRunStatusValue = AiRunStatus;
export type AiTaskTypeValue = AiTaskType;
export type AiReportKindValue = AiReportKind;
export type AiProviderSettingRecord = AiProviderSetting;
export type AiChannelClassificationRecord = AiChannelClassification;
export type AiVideoAnalysisRecord = AiVideoAnalysis;
export type AiReportRecord = AiReport;
export type AiRunRecord = AiRun;
