import type {
  AIModelInfo,
  AIProvider,
  AIProviderHealth,
  StructuredAIRequest,
  TextAIRequest,
} from "./contracts.js";
import { AIProviderError } from "./errors.js";

export interface NvidiaProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
  repairOnSchemaError?: boolean;
}

interface NvidiaChatResponse {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
}

interface NvidiaModelsResponse {
  data?: Array<{ id?: string; owned_by?: string }>;
}

function rootUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/u, "");
}

function extractContent(body: NvidiaChatResponse): string {
  const content = body.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((part) => part.text ?? "").join("") : content;
  if (!text?.trim()) {
    throw new AIProviderError("AI_REQUEST_FAILED", "NVIDIA returned no message content", true);
  }
  return text.trim();
}

export class NvidiaProvider implements AIProvider {
  readonly id = "NVIDIA" as const;
  private readonly requestFetch: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: NvidiaProviderOptions) {
    this.requestFetch = options.fetch ?? globalThis.fetch;
    this.baseUrl = rootUrl(options.baseUrl ?? "https://integrate.api.nvidia.com/v1");
  }

  async structured<T>(request: StructuredAIRequest<T>): Promise<T> {
    const raw = await this.generate(request.prompt, request.model ?? this.options.model, request);
    const parsed = this.parseAndValidate(raw, request);
    if (parsed.success) return parsed.data;
    if (!(request.repairOnSchemaError ?? this.options.repairOnSchemaError ?? true)) {
      throw new AIProviderError("AI_SCHEMA_INVALID", "NVIDIA response failed the required schema");
    }
    const repaired = await this.generate(
      `Return ONLY valid JSON matching the requested schema. Fix this invalid response:\n${raw}`,
      request.model ?? this.options.model,
      request,
    );
    const repairedResult = this.parseAndValidate(repaired, request);
    if (!repairedResult.success) {
      throw new AIProviderError("AI_SCHEMA_INVALID", "NVIDIA response failed the required schema");
    }
    return repairedResult.data;
  }

  text(request: TextAIRequest): Promise<string> {
    return this.generate(request.prompt, request.model ?? this.options.model, request);
  }

  async health(): Promise<AIProviderHealth> {
    const model = this.options.model;
    if (!this.options.apiKey) {
      return {
        provider: this.id,
        status: "DISABLED",
        code: "AI_DISABLED",
        ...(model ? { model } : {}),
      };
    }
    const started = Date.now();
    try {
      const response = await this.requestFetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: this.headers(),
      });
      if (response.status === 401 || response.status === 403) {
        return {
          provider: this.id,
          status: "UNAVAILABLE",
          code: "AI_CONFIGURATION_INVALID",
          ...(model ? { model } : {}),
        };
      }
      if (!response.ok) {
        return {
          provider: this.id,
          status: "UNAVAILABLE",
          code: `HTTP_${response.status}`,
          ...(model ? { model } : {}),
        };
      }
      return {
        provider: this.id,
        status: "HEALTHY",
        latencyMs: Date.now() - started,
        ...(model ? { model } : {}),
      };
    } catch {
      return {
        provider: this.id,
        status: "UNAVAILABLE",
        code: "AI_UNAVAILABLE",
        ...(model ? { model } : {}),
      };
    }
  }

  async models(): Promise<AIModelInfo[]> {
    if (!this.options.apiKey) {
      throw new AIProviderError("AI_DISABLED", "NVIDIA API key is not configured");
    }
    let response: Response;
    try {
      response = await this.requestFetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: this.headers(),
      });
    } catch {
      throw new AIProviderError("AI_UNAVAILABLE", "NVIDIA model discovery failed", true);
    }
    this.throwForResponse(response, "NVIDIA model discovery");
    let body: NvidiaModelsResponse;
    try {
      body = (await response.json()) as NvidiaModelsResponse;
    } catch {
      throw new AIProviderError(
        "AI_REQUEST_FAILED",
        "NVIDIA returned malformed model metadata",
        true,
      );
    }
    return (body.data ?? [])
      .filter(
        (model): model is { id: string; owned_by?: string } =>
          typeof model.id === "string" && model.id.length > 0,
      )
      .map((model) => ({
        id: model.id,
        label: model.id,
        source: "DISCOVERED" as const,
        ...(model.owned_by ? { ownedBy: model.owned_by } : {}),
      }));
  }

  private async generate(
    prompt: string,
    model: string | undefined,
    request: { temperature?: number; maxOutputTokens?: number },
  ): Promise<string> {
    if (!this.options.apiKey) {
      throw new AIProviderError("AI_DISABLED", "NVIDIA API key is not configured");
    }
    if (!model) {
      throw new AIProviderError("AI_CONFIGURATION_INVALID", "NVIDIA model is not configured");
    }
    let response: Response;
    try {
      response = await this.requestFetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
        }),
      });
    } catch {
      throw new AIProviderError("AI_UNAVAILABLE", "NVIDIA network request failed", true);
    }
    this.throwForResponse(response, "NVIDIA request");
    let body: NvidiaChatResponse;
    try {
      body = (await response.json()) as NvidiaChatResponse;
    } catch {
      throw new AIProviderError("AI_REQUEST_FAILED", "NVIDIA returned malformed JSON", true);
    }
    return extractContent(body);
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.options.apiKey ?? ""}` };
  }

  private throwForResponse(response: Response, operation: string): void {
    if (response.status === 429)
      throw new AIProviderError("AI_RATE_LIMITED", `${operation} rate limit reached`, true, 429);
    if (response.status === 401 || response.status === 403) {
      throw new AIProviderError(
        "AI_CONFIGURATION_INVALID",
        `${operation} credentials were rejected`,
        false,
        response.status,
      );
    }
    if (!response.ok)
      throw new AIProviderError(
        "AI_REQUEST_FAILED",
        `${operation} failed with HTTP ${response.status}`,
        true,
        response.status,
      );
  }

  private parseAndValidate<T>(raw: string, request: StructuredAIRequest<T>) {
    try {
      return request.schema.safeParse(JSON.parse(raw) as unknown);
    } catch {
      return { success: false as const, error: undefined };
    }
  }
}
