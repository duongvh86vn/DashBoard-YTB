import { z } from "zod";

import {
  baseEnvSchema,
  databaseUrlSchema,
  type EnvironmentInput,
  tcpPortSchema,
} from "./base-env.js";

function addIssue(context: z.RefinementCtx, message: string) {
  context.addIssue({ code: "custom", message });
}

function parseHttpOrigin(value: string, context: z.RefinementCtx, name: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    addIssue(context, `${name} must be an absolute HTTP(S) origin`);
    return z.NEVER;
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== value ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    addIssue(context, `${name} must be an absolute HTTP(S) origin`);
    return z.NEVER;
  }

  return url.origin;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.")
  );
}

const httpOriginSchema = z
  .string()
  .trim()
  .transform((value, context) => parseHttpOrigin(value, context, "APP_PUBLIC_URL"));

const allowedOriginsSchema = z
  .string()
  .min(1)
  .transform((value, context) => {
    const origins = new Set<string>();

    for (const origin of value.split(",")) {
      const parsedOrigin = parseHttpOrigin(origin.trim(), context, "APP_ALLOWED_ORIGINS");

      if (parsedOrigin !== z.NEVER) {
        origins.add(parsedOrigin);
      }
    }

    return [...origins];
  });

export interface AuthEnvironment {
  DEPLOYMENT_MODE: "LOCAL" | "PUBLIC";
  APP_PUBLIC_URL: string;
  APP_ALLOWED_ORIGINS: string[];
  SESSION_SECRET: string;
  SESSION_IDLE_MINUTES: number;
  SESSION_ABSOLUTE_HOURS: number;
  LOGIN_MAX_ATTEMPTS: number;
  LOGIN_LOCK_MINUTES: number;
}

const apiEnvSchema = baseEnvSchema
  .extend({
    DATABASE_URL: databaseUrlSchema,
    API_PORT: tcpPortSchema.default(5000),
    WORKER_HEARTBEAT_STALE_SECONDS: z.coerce.number().int().positive().default(45),
    DEPLOYMENT_MODE: z.enum(["LOCAL", "PUBLIC"]),
    APP_PUBLIC_URL: httpOriginSchema,
    APP_ALLOWED_ORIGINS: allowedOriginsSchema,
    SESSION_SECRET: z.string().min(32),
    SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(120),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(24),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  })
  .superRefine((value, context) => {
    const publicUrl = new URL(value.APP_PUBLIC_URL);

    if (value.DEPLOYMENT_MODE === "PUBLIC" && publicUrl.protocol !== "https:") {
      addIssue(context, "APP_PUBLIC_URL must use HTTPS in PUBLIC mode");
    }

    if (
      value.DEPLOYMENT_MODE === "LOCAL" &&
      publicUrl.protocol === "http:" &&
      !isLoopbackHostname(publicUrl.hostname)
    ) {
      addIssue(context, "APP_PUBLIC_URL may use HTTP only for a loopback host in LOCAL mode");
    }

    if (!value.APP_ALLOWED_ORIGINS.includes(value.APP_PUBLIC_URL)) {
      addIssue(context, "APP_ALLOWED_ORIGINS must include APP_PUBLIC_URL");
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function parseApiEnv(input: EnvironmentInput): ApiEnv {
  return apiEnvSchema.parse(input);
}
