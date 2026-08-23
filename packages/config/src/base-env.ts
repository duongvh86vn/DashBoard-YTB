import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_VERSION: z.string().min(1).max(64).default("0.1.0"),
  APP_TIMEZONE: z.string().min(1).default("Asia/Bangkok"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SECRET_ENCRYPTION_KEY: optionalSecret,
  GEMINI_API_KEY: optionalSecret,
  GEMINI_BASE_URL: z.string().url().optional(),
  GEMINI_FAST_MODEL: z.string().min(1).optional(),
  GEMINI_ANALYSIS_MODEL: z.string().min(1).optional(),
  NVIDIA_API_KEY: optionalSecret,
  NVIDIA_BASE_URL: z.string().url().optional(),
  NVIDIA_FAST_MODEL: z.string().min(1).optional(),
  NVIDIA_ANALYSIS_MODEL: z.string().min(1).optional(),
  NVIDIA_LONG_CONTEXT_MODEL: z.string().min(1).optional(),
});

export const databaseUrlSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    let databaseUrl: URL;

    try {
      databaseUrl = new URL(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "DATABASE_URL must be a valid URL",
      });
      return;
    }

    if (databaseUrl.protocol !== "postgresql:" && databaseUrl.protocol !== "postgres:") {
      context.addIssue({
        code: "custom",
        message: "DATABASE_URL must use the PostgreSQL protocol",
      });
    }

    if (databaseUrl.hostname.length === 0) {
      context.addIssue({
        code: "custom",
        message: "DATABASE_URL must include a hostname",
      });
    }

    if (databaseUrl.pathname.length <= 1) {
      context.addIssue({
        code: "custom",
        message: "DATABASE_URL must include a database path",
      });
    }
  });

export const tcpPortSchema = z.coerce.number().int().min(1).max(65_535);

export const booleanEnvSchema = z.enum(["true", "false"]).transform((value) => value === "true");

export type EnvironmentInput = Record<string, string | undefined>;
