import type {
  AIModelRole,
  AIModelRoleConfig,
  AIProvider,
  AIProviderHealth,
  AIProviderId,
  StructuredAIRequest,
  TextAIRequest,
} from "./contracts.js";
import { isProviderFailure } from "./errors.js";

export interface AIProviderRouterOptions {
  roles?: Partial<Record<AIModelRole, AIModelRoleConfig>>;
  providers?: readonly AIProvider[];
}

const defaultTaskRoles: Record<string, AIModelRole> = {
  CHANNEL_CLASSIFICATION: "FAST",
  HEALTH_AMBIGUITY: "FAST",
  VIDEO_ANALYSIS: "ANALYSIS",
  DAILY_REPORT: "ANALYSIS",
  WEEKLY_REPORT: "ANALYSIS",
};

/** Routes configured logical roles while keeping deterministic fallback behavior. */
export class AIProviderRouter implements AIProvider {
  private readonly allProviders: readonly AIProvider[];
  private roles: Partial<Record<AIModelRole, AIModelRoleConfig>>;
  private lastUsedProviderId: AIProviderId;
  private lastUsedModelId: string | null = null;

  constructor(
    private readonly primary: AIProvider,
    private readonly fallback?: AIProvider,
    options: AIProviderRouterOptions = {},
  ) {
    this.allProviders = [
      ...new Set(
        [primary, fallback, ...(options.providers ?? [])].filter(
          (provider): provider is AIProvider => provider !== undefined,
        ),
      ),
    ];
    this.roles = options.roles ?? {};
    this.lastUsedProviderId = primary.id;
  }

  get id(): AIProviderId {
    return this.lastUsedProviderId;
  }

  get lastModelId(): string | null {
    return this.lastUsedModelId;
  }

  /** Applies ADMIN/database role changes without rebuilding provider clients. */
  setRoles(roles: Partial<Record<AIModelRole, AIModelRoleConfig>>): void {
    this.roles = { ...this.roles, ...roles };
  }

  async structured<T>(request: StructuredAIRequest<T>): Promise<T> {
    const selected = this.selectProvider(request);
    try {
      const result = await selected.provider.structured(selected.request);
      this.recordUse(selected.provider, selected.request.model);
      return result;
    } catch (error) {
      if (!isProviderFailure(error)) throw error;
      return this.tryFallback(selected.provider, selected.request, (candidate, routedRequest) =>
        candidate.structured(routedRequest),
      );
    }
  }

  async text(request: TextAIRequest): Promise<string> {
    const selected = this.selectProvider(request);
    try {
      const result = await selected.provider.text(selected.request);
      this.recordUse(selected.provider, selected.request.model);
      return result;
    } catch (error) {
      if (!isProviderFailure(error)) throw error;
      return this.tryFallback(selected.provider, selected.request, (candidate, routedRequest) =>
        candidate.text(routedRequest),
      );
    }
  }

  async health(): Promise<AIProviderHealth> {
    const health = await this.healthAll();
    const primary = health.find((item) => item.provider === this.primary.id) ?? health[0]!;
    const fallback = health.find((item) => item.provider !== this.primary.id);
    if (primary.status === "HEALTHY") return primary;
    if (fallback?.status === "HEALTHY") return { ...fallback, code: "FALLBACK_ACTIVE" };
    if (primary.status === "DISABLED" && (!fallback || fallback.status === "DISABLED")) {
      return primary;
    }
    const code = primary.code ?? fallback?.code;
    return code
      ? { ...primary, status: "UNAVAILABLE", code }
      : { ...primary, status: "UNAVAILABLE" };
  }

  async healthAll(): Promise<AIProviderHealth[]> {
    return Promise.all(this.allProviders.map((provider) => provider.health()));
  }

  async models(providerId: AIProviderId): Promise<unknown[]> {
    const provider = this.allProviders.find((candidate) => candidate.id === providerId);
    if (!provider || !("models" in provider) || typeof provider.models !== "function") return [];
    return provider.models() as Promise<unknown[]>;
  }

  private selectProvider<T extends StructuredAIRequest<unknown> | TextAIRequest>(
    request: T,
  ): {
    provider: AIProvider;
    request: T;
  } {
    const role = this.roles[defaultTaskRoles[request.taskType] ?? "ANALYSIS"];
    const roleProvider = role
      ? this.allProviders.find((provider) => provider.id === role.provider)
      : undefined;
    const provider = roleProvider ?? this.primary;
    const model = role?.modelId ?? request.model;
    return { provider, request: model ? ({ ...request, model } as T) : request };
  }

  private async tryFallback<T extends StructuredAIRequest<unknown> | TextAIRequest, R>(
    selectedProvider: AIProvider,
    request: T,
    operation: (provider: AIProvider, routedRequest: T) => Promise<R>,
  ): Promise<R> {
    const candidates = this.allProviders.filter((provider) => provider !== selectedProvider);
    let lastError: unknown;
    for (const candidate of candidates) {
      const fallbackRole = this.roles.FALLBACK;
      const fallbackModel =
        fallbackRole?.provider === candidate.id ? fallbackRole.modelId : undefined;
      const fallbackRequest = fallbackModel
        ? ({ ...request, model: fallbackModel } as T)
        : (() => {
            return Object.fromEntries(
              Object.entries(request).filter(([key]) => key !== "model"),
            ) as T;
          })();
      try {
        const result = await operation(candidate, fallbackRequest);
        this.recordUse(candidate, fallbackRequest.model);
        return result;
      } catch (error) {
        lastError = error;
        if (!isProviderFailure(error)) throw error;
      }
    }
    throw lastError ?? new Error("No AI provider is available");
  }

  private recordUse(provider: AIProvider, model: string | undefined): void {
    this.lastUsedProviderId = provider.id;
    this.lastUsedModelId = model ?? null;
  }
}
