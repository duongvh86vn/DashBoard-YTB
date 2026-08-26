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
import type { AiModelRoleValue, AiProviderSettingRecord, ChannelUnitOfWork } from "@yt-monitor/db";

export interface WorkerAiRuntimeEnvironment {
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

export interface WorkerAiRuntime {
  provider: AIProvider;
  model: string | null;
  enabled: boolean;
}

function settingFor(
  settings: readonly AiProviderSettingRecord[],
  provider: AIProviderId,
): AiProviderSettingRecord | undefined {
  return settings.find((setting) => setting.provider === provider);
}

function configuredModels(setting: AiProviderSettingRecord | undefined): Record<string, string> {
  if (!setting?.configuredModels || typeof setting.configuredModels !== "object") return {};
  return Object.fromEntries(
    Object.entries(setting.configuredModels).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].trim().length > 0,
    ),
  );
}

function selectedModel(
  setting: AiProviderSettingRecord | undefined,
  preferredRoles: readonly AIModelRole[],
): string | undefined {
  const models = configuredModels(setting);
  for (const role of preferredRoles) {
    const model = models[role];
    if (model) return model;
  }
  return undefined;
}

function providerKey(
  setting: AiProviderSettingRecord | undefined,
  environmentKey: string | undefined,
  encryptionKey: string | undefined,
): string | undefined {
  let storedKey: string | undefined;
  if (setting?.apiKeyEncrypted) {
    if (!encryptionKey) {
      throw new Error("SECRET_ENCRYPTION_KEY is required to load an encrypted AI key");
    }
    storedKey = decryptSecret(setting.apiKeyEncrypted, encryptionKey);
  }
  const enabled = setting?.isEnabled ?? Boolean(storedKey ?? environmentKey);
  return enabled ? (storedKey ?? environmentKey) : undefined;
}

function roleMap(
  roles: readonly {
    role: AiModelRoleValue;
    provider: AIProviderId;
    modelId: string;
    isEnabled: boolean;
  }[],
): Partial<Record<AIModelRole, AIModelRoleConfig>> {
  const result: Partial<Record<AIModelRole, AIModelRoleConfig>> = {};
  for (const role of roles) {
    if (!role.isEnabled) continue;
    result[role.role] = {
      role: role.role,
      provider: role.provider,
      modelId: role.modelId,
    };
  }
  return result;
}

/** Loads fresh database settings for every scheduled run so ADMIN changes need no worker restart. */
export async function loadWorkerAiRuntime(input: {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  environment: WorkerAiRuntimeEnvironment;
}): Promise<WorkerAiRuntime> {
  const { settings, roles } = await input.unitOfWork.transaction(async (repositories) => ({
    settings: await repositories.ai.listProviderSettings(),
    roles: await repositories.ai.listModelRoles(),
  }));
  const geminiSetting = settingFor(settings, "GEMINI");
  const nvidiaSetting = settingFor(settings, "NVIDIA");
  const geminiKey = providerKey(
    geminiSetting,
    input.environment.GEMINI_API_KEY,
    input.environment.SECRET_ENCRYPTION_KEY,
  );
  const nvidiaKey = providerKey(
    nvidiaSetting,
    input.environment.NVIDIA_API_KEY,
    input.environment.SECRET_ENCRYPTION_KEY,
  );
  const geminiModel =
    selectedModel(geminiSetting, ["ANALYSIS", "FAST"]) ??
    input.environment.GEMINI_ANALYSIS_MODEL ??
    input.environment.GEMINI_FAST_MODEL ??
    getRecommendedAiModel("GEMINI")?.id;
  const nvidiaModel =
    selectedModel(nvidiaSetting, ["ANALYSIS", "LONG_CONTEXT", "FAST", "FALLBACK"]) ??
    input.environment.NVIDIA_ANALYSIS_MODEL ??
    input.environment.NVIDIA_LONG_CONTEXT_MODEL ??
    input.environment.NVIDIA_FAST_MODEL ??
    getRecommendedAiModel("NVIDIA")?.id;

  const providers: Record<AIProviderId, AIProvider> = {
    GEMINI: new GeminiProvider({
      ...(geminiKey ? { apiKey: geminiKey } : {}),
      ...(geminiSetting?.baseUrl
        ? { baseUrl: geminiSetting.baseUrl }
        : input.environment.GEMINI_BASE_URL
          ? { baseUrl: input.environment.GEMINI_BASE_URL }
          : {}),
      ...(geminiModel ? { model: geminiModel } : {}),
    }),
    NVIDIA: new NvidiaProvider({
      ...(nvidiaKey ? { apiKey: nvidiaKey } : {}),
      ...(nvidiaSetting?.baseUrl
        ? { baseUrl: nvidiaSetting.baseUrl }
        : input.environment.NVIDIA_BASE_URL
          ? { baseUrl: input.environment.NVIDIA_BASE_URL }
          : {}),
      ...(nvidiaModel ? { model: nvidiaModel } : {}),
    }),
  };
  const configured: Record<AIProviderId, boolean> = {
    GEMINI: Boolean(geminiKey && geminiModel),
    NVIDIA: Boolean(nvidiaKey && nvidiaModel),
  };
  const priority = (provider: AIProviderId): number =>
    settingFor(settings, provider)?.priority ?? (provider === "GEMINI" ? 0 : 1);
  const ordered: AIProviderId[] = ["GEMINI", "NVIDIA"];
  ordered.sort((left, right) => {
    if (configured[left] !== configured[right]) return configured[left] ? -1 : 1;
    return priority(left) - priority(right) || left.localeCompare(right);
  });
  const primaryId = ordered[0] ?? "GEMINI";
  const fallbackId = ordered[1] ?? "NVIDIA";
  const router = new AIProviderRouter(providers[primaryId], providers[fallbackId], {
    roles: roleMap(roles),
    providers: Object.values(providers),
  });
  return {
    provider: router,
    model: null,
    enabled: configured.GEMINI || configured.NVIDIA,
  };
}
