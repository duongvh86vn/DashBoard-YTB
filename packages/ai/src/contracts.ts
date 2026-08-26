import type { z } from "zod";

export type AIProviderId = "GEMINI" | "NVIDIA";
export type AIModelRole = "FAST" | "ANALYSIS" | "LONG_CONTEXT" | "FALLBACK";
export type AIProviderHealthStatus = "DISABLED" | "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
export type AIModelSource = "BUNDLED" | "DISCOVERED";

export interface AIModelInfo {
  id: string;
  label?: string;
  description?: string;
  ownedBy?: string;
  source?: AIModelSource;
  recommended?: boolean;
}

export interface AIModelRoleConfig {
  role: AIModelRole;
  provider: AIProviderId;
  modelId: string;
}

export interface AIProviderHealth {
  provider: AIProviderId;
  status: AIProviderHealthStatus;
  model?: string;
  latencyMs?: number;
  code?: string;
}

export interface StructuredAIRequest<T> {
  taskType: string;
  prompt: string;
  schema: z.ZodType<T>;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  repairOnSchemaError?: boolean;
}

export interface TextAIRequest {
  taskType: string;
  prompt: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AIProvider {
  readonly id: AIProviderId;
  /** Model configured as this provider's implicit default, when one exists. */
  readonly defaultModelId?: string | null;
  /** Effective model used by the most recent attempted request. */
  readonly lastModelId?: string | null;
  structured<T>(request: StructuredAIRequest<T>): Promise<T>;
  text(request: TextAIRequest): Promise<string>;
  health(): Promise<AIProviderHealth>;
}
