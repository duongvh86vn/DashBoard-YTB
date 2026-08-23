import {
  channelClassificationSchema,
  createAnalysisFingerprint,
  type AIProvider,
  type AIProviderHealth,
  type ChannelClassification,
  AIProviderError,
  stableJson,
} from "@yt-monitor/ai";
import { decryptSecret, encryptSecret, maskSecret } from "@yt-monitor/crypto";
import type { ChannelUnitOfWork } from "@yt-monitor/db";

import type {
  AiApplicationPort,
  AiProviderStatus,
  AiStatusResponse,
} from "./ai-application.port.js";

const PROMPT_VERSION = "phase6-channel-classification-v1";

interface AiServiceOptions {
  unitOfWork: ChannelUnitOfWork;
  provider: AIProvider;
  model: string | null;
  encryptionKey?: string;
  now?: () => Date;
}

function healthToStatus(
  health: AIProviderHealth,
  configured: boolean,
  enabled: boolean,
  priority: number,
  masked: string | null,
  model: string | null,
): AiProviderStatus {
  return {
    provider: health.provider,
    status: health.status,
    configured,
    enabled,
    priority,
    model,
    apiKeyMasked: masked,
    code: health.code ?? null,
  };
}

function safeMaskedKey(encrypted: string | null, encryptionKey?: string): string | null {
  if (!encrypted) return null;
  if (!encryptionKey) return "••••••••";
  try {
    return maskSecret(decryptSecret(encrypted, encryptionKey));
  } catch {
    return "••••••••";
  }
}

export class AiService implements AiApplicationPort {
  private readonly now: () => Date;

  constructor(private readonly options: AiServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async status(): Promise<AiStatusResponse> {
    const [health, settings] = await Promise.all([
      this.options.provider.health(),
      this.options.unitOfWork.transaction((repositories) => repositories.ai.listProviderSettings()),
    ]);
    const setting = settings.find((item) => item.provider === health.provider);
    const configured = Boolean(setting?.apiKeyEncrypted) || health.status !== "DISABLED";
    const providers = [
      healthToStatus(
        health,
        configured,
        setting?.isEnabled ?? configured,
        setting?.priority ?? 0,
        safeMaskedKey(setting?.apiKeyEncrypted ?? null, this.options.encryptionKey),
        this.options.model,
      ),
    ];
    return {
      available: providers.some((item) => item.status === "HEALTHY" || item.status === "DEGRADED"),
      message: providers.some((item) => item.status === "HEALTHY")
        ? null
        : "AI analysis unavailable",
      providers,
    };
  }

  async updateSettings(
    input: Parameters<AiApplicationPort["updateSettings"]>[0],
  ): Promise<AiStatusResponse> {
    const existing = await this.options.unitOfWork.transaction(async (repositories) => {
      const settings = await repositories.ai.listProviderSettings();
      return settings.find((item) => item.provider === input.provider) ?? null;
    });
    let apiKeyEncrypted = existing?.apiKeyEncrypted ?? null;
    if (input.apiKey !== undefined) {
      if (!this.options.encryptionKey)
        throw new Error("SECRET_ENCRYPTION_KEY is required to save an AI key");
      apiKeyEncrypted = encryptSecret(input.apiKey, this.options.encryptionKey);
    }
    await this.options.unitOfWork.transaction((repositories) =>
      repositories.ai.upsertProviderSetting({
        provider: input.provider,
        isEnabled: input.isEnabled ?? existing?.isEnabled ?? false,
        priority: input.priority ?? existing?.priority ?? 0,
        baseUrl: input.baseUrl === undefined ? (existing?.baseUrl ?? null) : input.baseUrl,
        apiKeyEncrypted,
        configuredModels:
          input.configuredModels ?? (existing?.configuredModels as Record<string, string> | null),
      }),
    );
    return this.status();
  }

  async classifyChannel(input: { channelId: string }): Promise<unknown> {
    const source = await this.options.unitOfWork.transaction(async (repositories) => {
      const channel = await repositories.channels.findById(input.channelId);
      if (!channel) throw new Error("Channel not found");
      const videos = await repositories.videos.list({
        channelId: input.channelId,
        page: 1,
        pageSize: 20,
      });
      const videoIds = videos.items.map((video) => video.id);
      const metricSummary = {
        title: channel.title,
        description: channel.description,
        recentTitles: videos.items.map((video) => video.title ?? ""),
      };
      return { channel, videos, videoIds, metricSummary };
    });
    const fingerprint = createAnalysisFingerprint({
      channelId: input.channelId,
      timeRange: "recent-20-videos",
      videoIds: source.videoIds,
      metricSummary: source.metricSummary,
      promptVersion: PROMPT_VERSION,
    });
    const cached = await this.options.unitOfWork.transaction((repositories) =>
      repositories.ai.findChannelClassificationByFingerprint(fingerprint),
    );
    if (cached) return { classification: cached, cached: true };
    const started = this.now().getTime();
    try {
      const classification: ChannelClassification = await this.options.provider.structured({
        taskType: "CHANNEL_CLASSIFICATION",
        prompt: `Classify this YouTube channel. Return only the requested JSON object.\n${stableJson(source.metricSummary)}`,
        schema: channelClassificationSchema,
        ...(this.options.model ? { model: this.options.model } : {}),
        repairOnSchemaError: true,
      });
      const persisted = await this.options.unitOfWork.transaction(async (repositories) => {
        await repositories.ai.createRun({
          provider: this.options.provider.id,
          modelId: this.options.model ?? "configured",
          taskType: "CHANNEL_CLASSIFICATION",
          fingerprint,
          status: "SUCCESS",
          durationMs: this.now().getTime() - started,
        });
        return repositories.ai.upsertChannelClassification({
          ...classification,
          channelId: input.channelId,
          subNiches: classification.subNiches,
          provider: this.options.provider.id,
          modelId: this.options.model ?? "configured",
          fingerprint,
        });
      });
      return { classification: persisted, cached: false };
    } catch (error) {
      const code = error instanceof AIProviderError ? error.code : "AI_REQUEST_FAILED";
      await this.options.unitOfWork.transaction((repositories) =>
        repositories.ai.createRun({
          provider: this.options.provider.id,
          modelId: this.options.model ?? "configured",
          taskType: "CHANNEL_CLASSIFICATION",
          fingerprint,
          status: code === "AI_SCHEMA_INVALID" ? "SCHEMA_INVALID" : "UNAVAILABLE",
          durationMs: this.now().getTime() - started,
          errorCode: code,
        }),
      );
      throw error;
    }
  }

  async getReport(input: { kind: "DAILY" | "WEEKLY"; reportDate: Date }): Promise<unknown> {
    const report = await this.options.unitOfWork.transaction((repositories) =>
      repositories.ai.findReport(input.kind, input.reportDate),
    );
    return {
      kind: input.kind,
      reportDate: input.reportDate.toISOString().slice(0, 10),
      available: report !== null,
      report,
    };
  }
}
