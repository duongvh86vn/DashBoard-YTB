import type {
  AIProvider,
  AIProviderHealth,
  StructuredAIRequest,
  TextAIRequest,
} from "./contracts.js";
import { AIProviderError } from "./errors.js";

export class NoopAIProvider implements AIProvider {
  readonly id = "GEMINI" as const;

  health(): Promise<AIProviderHealth> {
    return Promise.resolve({ provider: this.id, status: "DISABLED", code: "AI_DISABLED" });
  }

  structured<T>(request: StructuredAIRequest<T>): Promise<T> {
    void request;
    return Promise.reject(new AIProviderError("AI_DISABLED", "AI provider is not configured"));
  }

  text(request: TextAIRequest): Promise<string> {
    void request;
    return Promise.reject(new AIProviderError("AI_DISABLED", "AI provider is not configured"));
  }
}
