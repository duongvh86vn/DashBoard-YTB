import type {
  AIModelInfo,
  AIProvider,
  AIProviderHealth,
  StructuredAIRequest,
  TextAIRequest,
} from "./contracts.js";
import { AIProviderError } from "./errors.js";

export interface GeminiProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
  repairOnSchemaError?: boolean;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

interface GeminiModelMetadata {
  name?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiModelsResponse {
  models?: GeminiModelMetadata[];
}

function endpoint(baseUrl: string, model: string): string {
  const root = baseUrl.replace(/\/$/, "");
  return `${root}/models/${encodeURIComponent(model)}:generateContent`;
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
  private lastUsedModelId: string | null = null;

  constructor(private readonly options: GeminiProviderOptions) {
    this.requestFetch = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  get defaultModelId(): string | null {
    return this.options.model ?? null;
  }

  get lastModelId(): string | null {
    return this.lastUsedModelId;
  }

  async structured<T>(request: StructuredAIRequest<T>): Promise<T> {
    const model = request.model ?? this.options.model;
    this.lastUsedModelId = model ?? null;
    const raw = await this.generate(request.prompt, model, request);
    const parsed = await this.parseAndValidate(raw, request);
    if (parsed.success) return parsed.data;
    if (!(request.repairOnSchemaError ?? this.options.repairOnSchemaError ?? true)) {
      throw new AIProviderError("AI_SCHEMA_INVALID", "Gemini response failed the required schema");
    }
    const repaired = await this.generate(
      `Return ONLY valid JSON matching the requested schema and all grounding rules.\nOriginal request:\n${request.prompt}\nInvalid response to repair:\n${raw}`,
      model,
      request,
    );
    const repairedResult = await this.parseAndValidate(repaired, request);
    if (!repairedResult.success) {
      throw new AIProviderError("AI_SCHEMA_INVALID", "Gemini response failed the required schema");
    }
    return repairedResult.data;
  }

  async text(request: TextAIRequest): Promise<string> {
    const model = request.model ?? this.options.model;
    this.lastUsedModelId = model ?? null;
    return this.generate(request.prompt, model, request);
  }

  async health(): Promise<AIProviderHealth> {
    if (!this.options.apiKey || !this.options.model) {
      return {
        provider: this.id,
        status: "DISABLED",
        code: "AI_DISABLED",
        ...(this.options.model ? { model: this.options.model } : {}),
      };
    }
    const started = Date.now();
    try {
      const response = await this.requestFetch(
        `${this.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(this.options.model)}`,
        { method: "GET", headers: this.headers() },
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

  async models(): Promise<AIModelInfo[]> {
    if (!this.options.apiKey) {
      throw new AIProviderError("AI_DISABLED", "Gemini API key is not configured");
    }
    let response: Response;
    try {
      response = await this.requestFetch(
        `${this.baseUrl.replace(/\/$/, "")}/models?pageSize=1000`,
        {
          method: "GET",
          headers: this.headers(),
        },
      );
    } catch {
      throw new AIProviderError("AI_UNAVAILABLE", "Gemini model discovery failed", true);
    }
    this.throwForResponse(response, "Gemini model discovery");
    let body: GeminiModelsResponse;
    try {
      body = (await response.json()) as GeminiModelsResponse;
    } catch {
      throw new AIProviderError(
        "AI_REQUEST_FAILED",
        "Gemini returned malformed model metadata",
        true,
      );
    }
    return (body.models ?? [])
      .filter(
        (model): model is GeminiModelMetadata & { name: string } =>
          typeof model.name === "string" &&
          model.name.length > 0 &&
          Array.isArray(model.supportedGenerationMethods) &&
          model.supportedGenerationMethods.includes("generateContent"),
      )
      .map((model) => {
        const id = model.name.startsWith("models/")
          ? model.name.slice("models/".length)
          : model.name;
        const label = model.displayName?.trim() || id;
        const description = model.description?.trim();
        return {
          id,
          label,
          ownedBy: "Google",
          source: "DISCOVERED" as const,
          ...(description ? { description } : {}),
        };
      });
  }

  private async generate(
    prompt: string,
    model: string | undefined,
    request: { temperature?: number; maxOutputTokens?: number },
  ): Promise<string> {
    if (!model) {
      throw new AIProviderError("AI_CONFIGURATION_INVALID", "Gemini model is not configured");
    }
    if (!this.options.apiKey)
      throw new AIProviderError("AI_DISABLED", "Gemini API key is not configured");
    let response: Response;
    try {
      response = await this.requestFetch(endpoint(this.baseUrl, model), {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
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

  private headers(): Record<string, string> {
    return { "x-goog-api-key": this.options.apiKey ?? "" };
  }

  private throwForResponse(response: Response, operation: string): void {
    if (response.status === 429) {
      throw new AIProviderError("AI_RATE_LIMITED", `${operation} rate limit reached`, true, 429);
    }
    if (response.status === 401 || response.status === 403) {
      throw new AIProviderError(
        "AI_CONFIGURATION_INVALID",
        `${operation} credentials were rejected`,
        false,
        response.status,
      );
    }
    if (!response.ok) {
      throw new AIProviderError(
        "AI_REQUEST_FAILED",
        `${operation} failed with HTTP ${response.status}`,
        true,
        response.status,
      );
    }
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
