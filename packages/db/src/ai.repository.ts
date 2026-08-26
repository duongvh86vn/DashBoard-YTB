import type { Prisma as PrismaTypes } from "./generated/prisma/client.js";
import type {
  AiChannelClassificationRecord,
  AiProviderSettingRecord,
  AiReportKindValue,
  AiReportRecord,
  AiRunRecord,
  AiTaskTypeValue,
  AiVideoAnalysisRecord,
} from "./ai-records.js";

type AiClient = Pick<
  PrismaTypes.TransactionClient,
  | "aiProviderSetting"
  | "aiModelRoleConfig"
  | "aiRun"
  | "aiChannelClassification"
  | "aiVideoAnalysis"
  | "aiReport"
>;

export interface UpsertAiProviderSettingInput {
  provider: "GEMINI" | "NVIDIA";
  isEnabled: boolean;
  priority: number;
  baseUrl: string | null;
  apiKeyEncrypted: string | null;
  configuredModels: PrismaTypes.InputJsonValue | null;
}

export interface CreateAiRunInput {
  provider: "GEMINI" | "NVIDIA";
  modelId: string;
  taskType: AiTaskTypeValue;
  fingerprint: string;
  status: "SUCCESS" | "FAILED" | "SCHEMA_INVALID" | "UNAVAILABLE";
  durationMs: number;
  errorCode?: string | null;
  inputTokenEstimate?: number | null;
  outputTokenEstimate?: number | null;
}

export interface UpsertAiModelRoleInput {
  role: "FAST" | "ANALYSIS" | "LONG_CONTEXT" | "FALLBACK";
  provider: "GEMINI" | "NVIDIA";
  modelId: string;
  temperature: number | null;
  maxOutputTokens: number | null;
  isEnabled: boolean;
}

export interface UpsertAiChannelClassificationInput {
  channelId: string;
  primaryNiche: string;
  subNiches: PrismaTypes.InputJsonValue;
  language: string;
  contentFormat: string;
  confidence: number;
  provider: "GEMINI" | "NVIDIA";
  modelId: string;
  fingerprint: string;
}

export interface UpsertAiVideoAnalysisInput {
  videoId: string;
  summary: string;
  topic: string;
  titlePattern: PrismaTypes.InputJsonValue;
  strengths: PrismaTypes.InputJsonValue;
  possibleFactors: PrismaTypes.InputJsonValue;
  anomalies: PrismaTypes.InputJsonValue;
  confidence: number;
  provider: "GEMINI" | "NVIDIA";
  modelId: string;
  fingerprint: string;
}

export interface UpsertAiReportInput {
  kind: AiReportKindValue;
  reportDate: Date;
  fingerprint: string;
  provider: "GEMINI" | "NVIDIA";
  modelId: string;
  result: PrismaTypes.InputJsonValue;
}

export class AiRepository {
  constructor(private readonly client: AiClient) {}

  listProviderSettings(): Promise<AiProviderSettingRecord[]> {
    return this.client.aiProviderSetting.findMany({
      orderBy: [{ priority: "asc" }, { provider: "asc" }],
    });
  }

  upsertProviderSetting(input: UpsertAiProviderSettingInput): Promise<AiProviderSettingRecord> {
    const data = {
      provider: input.provider,
      isEnabled: input.isEnabled,
      priority: input.priority,
      baseUrl: input.baseUrl,
      apiKeyEncrypted: input.apiKeyEncrypted,
      ...(input.configuredModels === null ? {} : { configuredModels: input.configuredModels }),
    };
    return this.client.aiProviderSetting.upsert({
      where: { provider: input.provider },
      create: data,
      update: data,
    });
  }

  listModelRoles() {
    return this.client.aiModelRoleConfig.findMany({ orderBy: { role: "asc" } });
  }

  upsertModelRole(input: UpsertAiModelRoleInput) {
    return this.client.aiModelRoleConfig.upsert({
      where: { role: input.role },
      create: input,
      update: input,
    });
  }

  createRun(input: CreateAiRunInput): Promise<AiRunRecord> {
    return this.client.aiRun.create({ data: input });
  }

  findChannelClassificationByFingerprint(
    fingerprint: string,
  ): Promise<AiChannelClassificationRecord | null> {
    return this.client.aiChannelClassification.findFirst({
      where: { fingerprint },
      orderBy: { createdAt: "desc" },
    });
  }

  upsertChannelClassification(
    input: UpsertAiChannelClassificationInput,
  ): Promise<AiChannelClassificationRecord> {
    return this.client.aiChannelClassification.upsert({
      where: { channelId: input.channelId },
      create: input,
      update: input,
    });
  }

  findVideoAnalysisByFingerprint(fingerprint: string): Promise<AiVideoAnalysisRecord | null> {
    return this.client.aiVideoAnalysis.findFirst({
      where: { fingerprint },
      orderBy: { createdAt: "desc" },
    });
  }

  upsertVideoAnalysis(input: UpsertAiVideoAnalysisInput): Promise<AiVideoAnalysisRecord> {
    return this.client.aiVideoAnalysis.upsert({
      where: { videoId: input.videoId },
      create: input,
      update: input,
    });
  }

  findReport(kind: AiReportKindValue, reportDate: Date): Promise<AiReportRecord | null> {
    return this.client.aiReport.findUnique({ where: { kind_reportDate: { kind, reportDate } } });
  }

  findLatestReport(kind: AiReportKindValue, onOrBefore: Date): Promise<AiReportRecord | null> {
    return this.client.aiReport.findFirst({
      where: { kind, reportDate: { lte: onOrBefore } },
      orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
    });
  }

  upsertReport(input: UpsertAiReportInput): Promise<AiReportRecord> {
    return this.client.aiReport.upsert({
      where: { kind_reportDate: { kind: input.kind, reportDate: input.reportDate } },
      create: input,
      update: input,
    });
  }
}
