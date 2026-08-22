const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*(?:"[^"]+"|[^;\s]+))?\s*$/i;

export interface CsrfRequestInput {
  method: string;
  origin: string | undefined;
  contentType: string | undefined;
  protectionHeader: string | undefined;
  allowedOrigins: readonly string[];
}

export function validateCsrfRequest(input: CsrfRequestInput): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) {
    return true;
  }

  return (
    input.origin !== undefined &&
    input.allowedOrigins.includes(input.origin) &&
    input.contentType !== undefined &&
    JSON_CONTENT_TYPE.test(input.contentType) &&
    input.protectionHeader === "1"
  );
}
