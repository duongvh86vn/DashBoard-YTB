import { z } from "zod";

import {
  baseEnvSchema,
  databaseUrlSchema,
  type EnvironmentInput,
  tcpPortSchema,
} from "./base-env.js";

const apiEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: databaseUrlSchema,
  API_PORT: tcpPortSchema.default(5000),
  WORKER_HEARTBEAT_STALE_SECONDS: z.coerce.number().int().positive().default(45),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function parseApiEnv(input: EnvironmentInput): ApiEnv {
  return apiEnvSchema.parse(input);
}
