import { z } from "zod";

const provider = z.enum(["GEMINI", "NVIDIA"]);

export function parseProvider(value: string): "GEMINI" | "NVIDIA" {
  return provider.parse(value);
}

export function parseProviderSettingsBody(value: unknown) {
  return z
    .object({
      provider,
      isEnabled: z.boolean().optional(),
      priority: z.number().int().min(0).max(100).optional(),
      baseUrl: z.string().url().nullable().optional(),
      apiKey: z.string().min(1).max(512).optional(),
      configuredModels: z.record(z.string().min(1), z.string().min(1).max(256)).optional(),
    })
    .strict()
    .parse(value);
}

export function parseChannelId(value: string): string {
  return z.uuid().parse(value);
}

export function parseReportKind(value: string): "DAILY" | "WEEKLY" {
  return z
    .enum(["daily", "weekly"])
    .transform((kind) => kind.toUpperCase() as "DAILY" | "WEEKLY")
    .parse(value);
}

export function parseReportDate(value: string): Date {
  const date = z.iso.date().parse(value);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid report date");
  return parsed;
}
