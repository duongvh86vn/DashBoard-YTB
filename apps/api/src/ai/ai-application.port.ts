export const AI_APPLICATION_PORT = Symbol("AI_APPLICATION_PORT");

export interface AiProviderStatus {
  provider: "GEMINI" | "NVIDIA";
  status: "DISABLED" | "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
  configured: boolean;
  enabled: boolean;
  priority: number;
  model: string | null;
  apiKeyMasked: string | null;
  code: string | null;
}

export interface AiStatusResponse {
  available: boolean;
  message: string | null;
  providers: AiProviderStatus[];
}

export interface AiApplicationPort {
  status(): Promise<AiStatusResponse>;
  updateSettings(input: {
    provider: "GEMINI" | "NVIDIA";
    isEnabled?: boolean | undefined;
    priority?: number | undefined;
    baseUrl?: string | null | undefined;
    apiKey?: string | undefined;
    configuredModels?: Record<string, string> | undefined;
  }): Promise<AiStatusResponse>;
  classifyChannel(input: { channelId: string }): Promise<unknown>;
  getReport(input: { kind: "DAILY" | "WEEKLY"; reportDate: Date }): Promise<unknown>;
}
