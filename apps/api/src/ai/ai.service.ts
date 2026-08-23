import {
  channelClassificationSchema,
  createAnalysisFingerprint,
  type AIProvider,
  type AIModelRole,
  type AIModelRoleConfig,
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

function providerHealthList(
  provider: AIProvider,
  single: AIProviderHealth,
): Promise<AIProviderHealth[]> {
  if ("healthAll" in provider && typeof provider.healthAll === "function") {
    return provider.healthAll() as Promise<AIProviderHealth[]>;
  }
  return Promise.resolve([single]);
}

function currentModelId(provider: AIProvider, configured: string | null): string {
  const routed = "lastModelId" in provider ? provider.lastModelId : undefined;
  return typeof routed === "string" && routed.length > 0 ? routed : (configured ?? "configured");
}

type RoleConfigurator = {
  setRoles(roles: Partial<Record<AIModelRole, AIModelRoleConfig>>): void;
};

function roleConfigurator(provider: AIProvider): RoleConfigurator | null {
  if ("setRoles" in provider && typeof provider.setRoles === "function") {
    return provider as AIProvider & RoleConfigurator;
  }
  return null;
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
    const healthList = await providerHealthList(this.options.provider, health);
    const providers = healthList.map((providerHealth) => {
      const setting = settings.find((item) => item.provider === providerHealth.provider);
      const configured = Boolean(setting?.apiKeyEncrypted) || providerHealth.status !== "DISABLED";
      const configuredModels =
        setting?.configuredModels && typeof setting.configuredModels === "object"
          ? (setting.configuredModels as Record<string, unknown>)
          : null;
      const configuredModel =
        configuredModels && typeof configuredModels.ANALYSIS === "string"
          ? configuredModels.ANALYSIS
          : null;
      return healthToStatus(
        providerHealth,
        configured,
        setting?.isEnabled ?? configured,
        setting?.priority ?? 0,
        safeMaskedKey(setting?.apiKeyEncrypted ?? null, this.options.encryptionKey),
        providerHealth.model ?? configuredModel ?? this.options.model,
      );
    });
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
    await this.options.unitOfWork.transaction(async (repositories) => {
      await repositories.ai.upsertProviderSetting({
        provider: input.provider,
        isEnabled: input.isEnabled ?? existing?.isEnabled ?? false,
        priority: input.priority ?? existing?.priority ?? 0,
        baseUrl: input.baseUrl === undefined ? (existing?.baseUrl ?? null) : input.baseUrl,
        apiKeyEncrypted,
        configuredModels:
          input.configuredModels ?? (existing?.configuredModels as Record<string, string> | null),
      });
      if (input.configuredModels) {
        for (const role of ["FAST", "ANALYSIS", "LONG_CONTEXT", "FALLBACK"] as const) {
          const modelId = input.configuredModels[role];
          if (modelId) {
            await repositories.ai.upsertModelRole({
              role,
              provider: input.provider,
              modelId,
              temperature: null,
              maxOutputTokens: null,
              isEnabled: true,
            });
          }
        }
      }
    });
    await this.applyPersistedRoles();
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
      await this.applyPersistedRoles();
      const classification: ChannelClassification = await this.options.provider.structured({
        taskType: "CHANNEL_CLASSIFICATION",
        prompt: `Classify this YouTube channel. Return only the requested JSON object.\n${stableJson(source.metricSummary)}`,
        schema: channelClassificationSchema,
        ...(this.options.model ? { model: this.options.model } : {}),
        repairOnSchemaError: true,
      });
      const modelId = currentModelId(this.options.provider, this.options.model);
      const persisted = await this.options.unitOfWork.transaction(async (repositories) => {
        await repositories.ai.createRun({
          provider: this.options.provider.id,
          modelId,
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
          modelId,
          fingerprint,
        });
      });
      return { classification: persisted, cached: false };
    } catch (error) {
      const code = error instanceof AIProviderError ? error.code : "AI_REQUEST_FAILED";
      const modelId = currentModelId(this.options.provider, this.options.model);
      await this.options.unitOfWork.transaction((repositories) =>
        repositories.ai.createRun({
          provider: this.options.provider.id,
          modelId,
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

  async discoverModels(input: { provider: "GEMINI" | "NVIDIA" }): Promise<unknown> {
    if (
      !("models" in this.options.provider) ||
      typeof this.options.provider.models !== "function"
    ) {
      return { provider: input.provider, models: [] };
    }
    const models = await (
      this.options.provider as { models(provider: "GEMINI" | "NVIDIA"): Promise<unknown[]> }
    ).models(input.provider);
    return { provider: input.provider, models };
  }

  async testProvider(input: { provider: "GEMINI" | "NVIDIA" }): Promise<unknown> {
    const health = await providerHealthList(
      this.options.provider,
      await this.options.provider.health(),
    );
    return (
      health.find((item) => item.provider === input.provider) ?? {
        provider: input.provider,
        status: "DISABLED",
        code: "AI_DISABLED",
      }
    );
  }

  private async applyPersistedRoles(): Promise<void> {
    const configurator = roleConfigurator(this.options.provider);
    if (!configurator) return;
    const persisted = await this.options.unitOfWork.transaction((repositories) =>
      repositories.ai.listModelRoles(),
    );
    const roles: Partial<Record<AIModelRole, AIModelRoleConfig>> = {};
    for (const item of persisted) {
      if (!item.isEnabled) continue;
      roles[item.role] = {
        role: item.role,
        provider: item.provider,
        modelId: item.modelId,
      };
    }
    configurator.setRoles(roles);
  }
}
