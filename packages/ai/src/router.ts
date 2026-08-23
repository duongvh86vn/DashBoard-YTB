import type {
  AIProvider,
  AIProviderHealth,
  StructuredAIRequest,
  TextAIRequest,
} from "./contracts.js";
import { isProviderFailure } from "./errors.js";

export class AIProviderRouter implements AIProvider {
  readonly id = "GEMINI" as const;

  constructor(
    private readonly primary: AIProvider,
    private readonly fallback?: AIProvider,
  ) {}

  async structured<T>(request: StructuredAIRequest<T>): Promise<T> {
    try {
      return await this.primary.structured(request);
    } catch (error) {
      if (!this.fallback || !isProviderFailure(error)) throw error;
      return this.fallback.structured(request);
    }
  }

  async text(request: TextAIRequest): Promise<string> {
    try {
      return await this.primary.text(request);
    } catch (error) {
      if (!this.fallback || !isProviderFailure(error)) throw error;
      return this.fallback.text(request);
    }
  }

  async health(): Promise<AIProviderHealth> {
    const [primary, fallback] = await Promise.all([
      this.primary.health(),
      this.fallback?.health() ?? Promise.resolve(undefined),
    ]);
    if (primary.status === "HEALTHY") return primary;
    if (fallback?.status === "HEALTHY") return { ...fallback, code: "FALLBACK_ACTIVE" };
    if (primary.status === "DISABLED" && !fallback) return primary;
    const code = primary.code ?? fallback?.code;
    return code
      ? { ...primary, status: "UNAVAILABLE", code }
      : { ...primary, status: "UNAVAILABLE" };
  }
}
