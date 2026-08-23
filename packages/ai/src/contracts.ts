import type { z } from "zod";

export type AIProviderId = "GEMINI" | "NVIDIA";
export type AIProviderHealthStatus = "DISABLED" | "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

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
  structured<T>(request: StructuredAIRequest<T>): Promise<T>;
  text(request: TextAIRequest): Promise<string>;
  health(): Promise<AIProviderHealth>;
}
