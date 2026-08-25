import {
  AIProviderRouter,
  GeminiProvider,
  getRecommendedAiModel,
  NvidiaProvider,
  type AIModelRole,
  type AIModelRoleConfig,
  type AIProvider,
  type AIProviderId,
} from "@yt-monitor/ai";
import { decryptSecret } from "@yt-monitor/crypto";

export interface AiRuntimeProviderSetting {
  provider: AIProviderId;
  isEnabled: boolean;
  apiKeyEncrypted: string | null;
  baseUrl: string | null;
  configuredModels: unknown;
}

export interface AiRuntimeModelRole {
  role: AIModelRole;
  provider: AIProviderId;
  modelId: string;
  isEnabled: boolean;
}

export interface AiRuntimeFactoryInput {
  settings: readonly AiRuntimeProviderSetting[];
  roles: readonly AiRuntimeModelRole[];
}

export interface AiRuntime {
  provider: AIProvider;
  configured: Record<AIProviderId, boolean>;
}

export type AiRuntimeFactory = (input: AiRuntimeFactoryInput) => AiRuntime;

export interface AiRuntimeEnvironment {
  SECRET_ENCRYPTION_KEY?: string | undefined;
  GEMINI_API_KEY?: string | undefined;
  GEMINI_BASE_URL?: string | undefined;
  GEMINI_FAST_MODEL?: string | undefined;
  GEMINI_ANALYSIS_MODEL?: string | undefined;
  NVIDIA_API_KEY?: string | undefined;
  NVIDIA_BASE_URL?: string | undefined;
  NVIDIA_FAST_MODEL?: string | undefined;
  NVIDIA_ANALYSIS_MODEL?: string | undefined;
  NVIDIA_LONG_CONTEXT_MODEL?: string | undefined;
}

function settingFor(
  settings: readonly AiRuntimeProviderSetting[],
  provider: AIProviderId,
): AiRuntimeProviderSetting | undefined {
  return settings.find((setting) => setting.provider === provider);
}

function configuredModels(setting: AiRuntimeProviderSetting | undefined): Record<string, string> {
  if (!setting?.configuredModels || typeof setting.configuredModels !== "object") return {};
  return Object.fromEntries(
    Object.entries(setting.configuredModels).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].trim().length > 0,
    ),
  );
}

function persistedKey(
  setting: AiRuntimeProviderSetting | undefined,
  encryptionKey: string | undefined,
): string | undefined {
  if (!setting?.apiKeyEncrypted) return undefined;
  if (!encryptionKey) {
    throw new Error("SECRET_ENCRYPTION_KEY is required to load an encrypted AI key");
  }
  return decryptSecret(setting.apiKeyEncrypted, encryptionKey);
}

function selectedModel(
  setting: AiRuntimeProviderSetting | undefined,
  preferredRoles: readonly AIModelRole[],
): string | undefined {
  const models = configuredModels(setting);
  for (const role of preferredRoles) {
    const model = models[role];
    if (model) return model;
  }
  return undefined;
}

function enabledKey(
  setting: AiRuntimeProviderSetting | undefined,
  storedKey: string | undefined,
  environmentKey: string | undefined,
): string | undefined {
  const enabled = setting?.isEnabled ?? Boolean(storedKey ?? environmentKey);
  return enabled ? (storedKey ?? environmentKey) : undefined;
}

/**
 * Builds short-lived provider clients from persisted encrypted settings. Environment values are
 * bootstrap fallbacks only; database settings take precedence after an ADMIN saves them.
 */
export function createAiRuntimeFactory(environment: AiRuntimeEnvironment): AiRuntimeFactory {
  return ({ settings, roles: persistedRoles }) => {
    const geminiSetting = settingFor(settings, "GEMINI");
    const nvidiaSetting = settingFor(settings, "NVIDIA");
    const geminiStoredKey = persistedKey(geminiSetting, environment.SECRET_ENCRYPTION_KEY);
    const nvidiaStoredKey = persistedKey(nvidiaSetting, environment.SECRET_ENCRYPTION_KEY);
    const geminiKey = enabledKey(geminiSetting, geminiStoredKey, environment.GEMINI_API_KEY);
    const nvidiaKey = enabledKey(nvidiaSetting, nvidiaStoredKey, environment.NVIDIA_API_KEY);

    const geminiModel =
      selectedModel(geminiSetting, ["ANALYSIS", "FAST"]) ??
      environment.GEMINI_ANALYSIS_MODEL ??
      environment.GEMINI_FAST_MODEL ??
      getRecommendedAiModel("GEMINI")?.id;
    const nvidiaModel =
      selectedModel(nvidiaSetting, ["ANALYSIS", "LONG_CONTEXT", "FAST", "FALLBACK"]) ??
      environment.NVIDIA_ANALYSIS_MODEL ??
      environment.NVIDIA_LONG_CONTEXT_MODEL ??
      environment.NVIDIA_FAST_MODEL ??
      getRecommendedAiModel("NVIDIA")?.id;

    const geminiProvider = new GeminiProvider({
      ...(geminiKey ? { apiKey: geminiKey } : {}),
      ...(geminiSetting?.baseUrl
        ? { baseUrl: geminiSetting.baseUrl }
        : environment.GEMINI_BASE_URL
          ? { baseUrl: environment.GEMINI_BASE_URL }
          : {}),
      ...(geminiModel ? { model: geminiModel } : {}),
    });
    const nvidiaProvider = new NvidiaProvider({
      ...(nvidiaKey ? { apiKey: nvidiaKey } : {}),
      ...(nvidiaSetting?.baseUrl
        ? { baseUrl: nvidiaSetting.baseUrl }
        : environment.NVIDIA_BASE_URL
          ? { baseUrl: environment.NVIDIA_BASE_URL }
          : {}),
      ...(nvidiaModel ? { model: nvidiaModel } : {}),
    });

    const roles: Partial<Record<AIModelRole, AIModelRoleConfig>> = {};
    if (environment.GEMINI_FAST_MODEL) {
      roles.FAST = {
        role: "FAST",
        provider: "GEMINI",
        modelId: environment.GEMINI_FAST_MODEL,
      };
    }
    if (environment.GEMINI_ANALYSIS_MODEL) {
      roles.ANALYSIS = {
        role: "ANALYSIS",
        provider: "GEMINI",
        modelId: environment.GEMINI_ANALYSIS_MODEL,
      };
    }
    if (environment.NVIDIA_LONG_CONTEXT_MODEL) {
      roles.LONG_CONTEXT = {
        role: "LONG_CONTEXT",
        provider: "NVIDIA",
        modelId: environment.NVIDIA_LONG_CONTEXT_MODEL,
      };
    }
    if (nvidiaModel) {
      roles.FALLBACK = { role: "FALLBACK", provider: "NVIDIA", modelId: nvidiaModel };
    }
    for (const item of persistedRoles) {
      if (!item.isEnabled) continue;
      roles[item.role] = {
        role: item.role,
        provider: item.provider,
        modelId: item.modelId,
      };
    }

    return {
      provider: new AIProviderRouter(geminiProvider, nvidiaProvider, {
        providers: [nvidiaProvider],
        roles,
      }),
      configured: {
        GEMINI: Boolean(geminiStoredKey ?? environment.GEMINI_API_KEY),
        NVIDIA: Boolean(nvidiaStoredKey ?? environment.NVIDIA_API_KEY),
      },
    };
  };
}
