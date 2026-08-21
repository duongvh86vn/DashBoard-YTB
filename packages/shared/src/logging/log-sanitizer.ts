const REDACTION_MARKER = "[Redacted]";

const SECRET_FIELD_NAMES = new Set([
  "authorization",
  "cookie",
  "databaseurl",
  "datasourceurl",
  "password",
  "passphrase",
  "proxyauthorization",
  "setcookie",
]);

const SECRET_FIELD_SUFFIXES = [
  "accesstoken",
  "apikey",
  "clientsecret",
  "connectionstring",
  "databaseurl",
  "encryptionkey",
  "password",
  "passphrase",
  "privatekey",
  "refreshtoken",
  "secret",
  "secretkey",
  "sessiontoken",
  "signingkey",
  "token",
] as const;

const URL_CREDENTIAL_PATTERN = /\b([a-z][a-z\d+.-]*:\/\/[^:/\s@?#]+:)([^@\s/?#]+)(@)/giu;

type ErrorRecord = Record<string, unknown>;

function normalizedFieldName(fieldName: string): string {
  return fieldName.replaceAll(/[^a-z\d]/giu, "").toLowerCase();
}

function isSecretField(fieldName: string): boolean {
  const normalized = normalizedFieldName(fieldName);

  return (
    SECRET_FIELD_NAMES.has(normalized) ||
    SECRET_FIELD_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function sanitizeString(value: string): string {
  return value.replace(
    URL_CREDENTIAL_PATTERN,
    (_match, prefix: string, _password: string, suffix: string) =>
      `${prefix}${REDACTION_MARKER}${suffix}`,
  );
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeErrorRecord(error: ErrorRecord): ErrorRecord {
  const safe: ErrorRecord = {
    type:
      typeof error.type === "string"
        ? sanitizeString(error.type)
        : typeof error.name === "string"
          ? sanitizeString(error.name)
          : "Error",
  };

  for (const field of ["code", "errno", "status", "statusCode", "syscall"] as const) {
    const value = error[field];
    if (typeof value === "string") {
      safe[field] = sanitizeString(value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      safe[field] = value;
    }
  }

  return safe;
}

function sanitizeValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const existing = seen.get(value);
  if (existing !== undefined) {
    return existing;
  }

  if (value instanceof Error) {
    const safe = safeErrorRecord(value as unknown as ErrorRecord);
    seen.set(value, safe);
    return safe;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    const safe: unknown[] = [];
    seen.set(value, safe);
    for (const item of value) {
      safe.push(sanitizeValue(item, seen));
    }
    return safe;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const safe: Record<string, unknown> = {};
  seen.set(value, safe);

  for (const [field, fieldValue] of Object.entries(value)) {
    safe[field] = isSecretField(field) ? REDACTION_MARKER : sanitizeValue(fieldValue, seen);
  }

  return safe;
}

export function sanitizeLogObject(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(value, new WeakMap()) as Record<string, unknown>;
}

export function sanitizeError(error: unknown): unknown {
  if (error === null || typeof error !== "object") {
    return sanitizeValue(error, new WeakMap());
  }

  return safeErrorRecord(error as ErrorRecord);
}

export function sanitizeLogMessage(message: unknown): unknown {
  return sanitizeValue(message, new WeakMap());
}

export function sanitizeSerializedLog(line: string): string {
  const newline = line.endsWith("\n") ? "\n" : "";

  try {
    const parsed = JSON.parse(line) as unknown;
    const safe = sanitizeValue(parsed, new WeakMap());
    return `${JSON.stringify(safe)}${newline}`;
  } catch {
    return `${JSON.stringify({ level: 50, msg: "Log entry could not be sanitized" })}${newline}`;
  }
}
