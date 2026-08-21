import pino, { type LoggerOptions } from "pino";

import {
  sanitizeError,
  sanitizeLogMessage,
  sanitizeLogObject,
  sanitizeSerializedLog,
} from "./log-sanitizer.js";

const REDACT_PATHS = [
  "password",
  "POSTGRES_PASSWORD",
  "DATABASE_URL",
  "databaseUrl",
  "connectionString",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['proxy-authorization']",
  "req.headers['x-api-key']",
  "res.headers.set-cookie",
  "SESSION_SECRET",
  "SECRET_ENCRYPTION_KEY",
  "GEMINI_API_KEY",
  "NVIDIA_API_KEY",
  "apiKey",
  "token",
  "*.password",
  "*.secret",
  "*.apiKey",
  "*.token",
  "*.databaseUrl",
  "*.connectionString",
] as const;

export function createPinoOptions(service: string, level = "info"): LoggerOptions {
  return {
    base: { service },
    level,
    messageKey: "msg",
    redact: {
      paths: [...REDACT_PATHS],
      censor: "[Redacted]",
    },
    formatters: {
      bindings: sanitizeLogObject,
      log: sanitizeLogObject,
    },
    serializers: {
      err: sanitizeError,
      error: sanitizeError,
      msg: sanitizeLogMessage,
      req: sanitizeLogMessage,
      res: sanitizeLogMessage,
    },
    hooks: {
      logMethod(args, method) {
        const firstArgument = args[0] as unknown;
        const hasImplicitMessage = args.length < 2 || args[1] === undefined;
        const errorProperty =
          firstArgument !== null && typeof firstArgument === "object"
            ? Object.getOwnPropertyDescriptor(firstArgument, "err")?.value
            : undefined;

        if (
          hasImplicitMessage &&
          (firstArgument instanceof Error || errorProperty instanceof Error)
        ) {
          method.apply(this, [firstArgument, "Error"]);
          return;
        }

        method.apply(this, args);
      },
      streamWrite: sanitizeSerializedLog,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}
