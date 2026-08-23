export type AIErrorCode =
  | "AI_DISABLED"
  | "AI_UNAVAILABLE"
  | "AI_RATE_LIMITED"
  | "AI_REQUEST_FAILED"
  | "AI_CONFIGURATION_INVALID"
  | "AI_SCHEMA_INVALID";

export class AIProviderError extends Error {
  constructor(
    readonly code: AIErrorCode,
    message: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export function isProviderFailure(error: unknown): boolean {
  return (
    error instanceof AIProviderError &&
    ["AI_DISABLED", "AI_UNAVAILABLE", "AI_RATE_LIMITED", "AI_REQUEST_FAILED"].includes(error.code)
  );
}
