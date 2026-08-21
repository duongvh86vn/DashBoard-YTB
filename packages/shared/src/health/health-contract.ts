import { z } from "zod";

export const HealthStatusSchema = z.enum(["ok", "degraded", "unavailable", "disabled"]);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

const healthDetailValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const HealthCheckSchema = z
  .object({
    status: HealthStatusSchema,
    required: z.boolean(),
    latencyMs: z.number().nonnegative().optional(),
    observedAt: z.iso.datetime().optional(),
    code: z.string().min(1).optional(),
    details: z.record(z.string(), healthDetailValueSchema).optional(),
  })
  .strict();

export type HealthCheck = z.infer<typeof HealthCheckSchema>;

export const HealthResponseSchema = z
  .object({
    status: HealthStatusSchema,
    service: z.enum(["web", "api", "database", "worker", "collectors", "ai"]),
    version: z.string().min(1),
    timestamp: z.iso.datetime(),
    checks: z.record(z.string(), HealthCheckSchema),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function aggregateHealthStatus(checks: Record<string, HealthCheck>): HealthStatus {
  const values = Object.values(checks);

  if (values.some((check) => check.required && check.status === "unavailable")) {
    return "unavailable";
  }

  if (
    values.some(
      (check) => check.status === "degraded" || (!check.required && check.status === "unavailable"),
    )
  ) {
    return "degraded";
  }

  if (values.length > 0 && values.every((check) => check.status === "disabled")) {
    return "disabled";
  }

  return "ok";
}
