import { z } from "zod";

import { baseEnvSchema, databaseUrlSchema, type EnvironmentInput } from "./base-env.js";

const workerEnvSchema = baseEnvSchema
  .extend({
    DATABASE_URL: databaseUrlSchema,
    WORKER_ID: z.string().min(1).max(128).optional(),
    WORKER_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),
    WORKER_HEARTBEAT_STALE_SECONDS: z.coerce.number().int().positive().default(45),
  })
  .superRefine((value, context) => {
    if (value.WORKER_HEARTBEAT_STALE_SECONDS <= value.WORKER_HEARTBEAT_INTERVAL_SECONDS) {
      context.addIssue({
        code: "custom",
        path: ["WORKER_HEARTBEAT_STALE_SECONDS"],
        message: "Heartbeat stale threshold must be longer than the write interval",
      });
    }
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(input: EnvironmentInput): WorkerEnv {
  return workerEnvSchema.parse(input);
}
