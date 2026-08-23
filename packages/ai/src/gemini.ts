import type {
  AIProvider,
  AIProviderHealth,
  StructuredAIRequest,
  TextAIRequest,
} from "./contracts.js";
import { AIProviderError } from "./errors.js";

export interface GeminiProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  fetch?: typeof globalThis.fetch;
  repairOnSchemaError?: boolean;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

function endpoint(baseUrl: string, model: string, apiKey: string): string {
  const root = baseUrl.replace(/\/$/, "");
  return `${root}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

function extractText(body: GeminiResponse): string {
  const text = body.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text)
    throw new AIProviderError("AI_REQUEST_FAILED", "Gemini returned no candidate text", true);
  return text;
}

export class GeminiProvider implements AIProvider {
  readonly id = "GEMINI" as const;
  private readonly requestFetch: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: GeminiProviderOptions) {
    this.requestFetch = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  async structured<T>(request: StructuredAIRequest<T>): Promise<T> {
    const raw = await this.generate(request.prompt, request.model ?? this.options.model, request);
    const parsed = await this.parseAndValidate(raw, request);
    if (parsed.success) return parsed.data;
    if (!(request.repairOnSchemaError ?? this.options.repairOnSchemaError ?? true)) {
      throw new AIProviderError("AI_SCHEMA_INVALID", "Gemini response failed the required schema");
    }
    const repaired = await this.generate(
      `Return ONLY valid JSON matching the requested schema. Fix this invalid response:\n${raw}`,
      request.model ?? this.options.model,
      request,
    );
    const repairedResult = await this.parseAndValidate(repaired, request);
    if (!repairedResult.success) {
      throw new AIProviderError("AI_SCHEMA_INVALID", "Gemini response failed the required schema");
    }
    return repairedResult.data;
  }

  async text(request: TextAIRequest): Promise<string> {
    return this.generate(request.prompt, request.model ?? this.options.model, request);
  }

  async health(): Promise<AIProviderHealth> {
    if (!this.options.apiKey || !this.options.model) {
      return {
        provider: this.id,
        status: "DISABLED",
        code: "AI_DISABLED",
        model: this.options.model,
      };
    }
    const started = Date.now();
    try {
      const response = await this.requestFetch(
        `${this.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(this.options.model)}?key=${encodeURIComponent(this.options.apiKey)}`,
        { method: "GET" },
      );
      if (!response.ok)
        return {
          provider: this.id,
          status: "UNAVAILABLE",
          code: `HTTP_${response.status}`,
          model: this.options.model,
        };
      return {
        provider: this.id,
        status: "HEALTHY",
        latencyMs: Date.now() - started,
        model: this.options.model,
      };
    } catch {
      return {
        provider: this.id,
        status: "UNAVAILABLE",
        code: "AI_UNAVAILABLE",
        model: this.options.model,
      };
    }
  }

  private async generate(
    prompt: string,
    model: string,
    request: { temperature?: number; maxOutputTokens?: number },
  ): Promise<string> {
    if (!this.options.apiKey)
      throw new AIProviderError("AI_DISABLED", "Gemini API key is not configured");
    let response: Response;
    try {
      response = await this.requestFetch(endpoint(this.baseUrl, model, this.options.apiKey), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            ...(request.maxOutputTokens === undefined
              ? {}
              : { maxOutputTokens: request.maxOutputTokens }),
          },
        }),
      });
    } catch {
      throw new AIProviderError("AI_UNAVAILABLE", "Gemini network request failed", true);
    }
    if (response.status === 429)
      throw new AIProviderError("AI_RATE_LIMITED", "Gemini rate limit reached", true, 429);
    if (response.status === 401 || response.status === 403) {
      throw new AIProviderError(
        "AI_CONFIGURATION_INVALID",
        "Gemini credentials were rejected",
        false,
        response.status,
      );
    }
    if (!response.ok)
      throw new AIProviderError(
        "AI_REQUEST_FAILED",
        `Gemini request failed with HTTP ${response.status}`,
        true,
        response.status,
      );
    let body: GeminiResponse;
    try {
      body = (await response.json()) as GeminiResponse;
    } catch {
      throw new AIProviderError("AI_REQUEST_FAILED", "Gemini returned malformed JSON", true);
    }
    return extractText(body);
  }

  private async parseAndValidate<T>(raw: string, request: StructuredAIRequest<T>) {
    try {
      const candidate = JSON.parse(raw) as unknown;
      return request.schema.safeParse(candidate);
    } catch {
      return { success: false as const, error: undefined };
    }
  }
}
