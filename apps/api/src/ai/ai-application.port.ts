export const AI_APPLICATION_PORT = Symbol("AI_APPLICATION_PORT");

export type AiConfiguredModels = Partial<
  Record<"FAST" | "ANALYSIS" | "LONG_CONTEXT" | "FALLBACK", string | undefined>
>;

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
    configuredModels?: AiConfiguredModels | undefined;
  }): Promise<AiStatusResponse>;
  classifyChannel(input: { channelId: string }): Promise<unknown>;
  getReport(input: { kind: "DAILY" | "WEEKLY"; reportDate: Date }): Promise<unknown>;
  discoverModels(input: { provider: "GEMINI" | "NVIDIA" }): Promise<unknown>;
  testProvider(input: { provider: "GEMINI" | "NVIDIA" }): Promise<unknown>;
}
