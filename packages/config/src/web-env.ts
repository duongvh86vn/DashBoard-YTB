import { z } from "zod";

import { baseEnvSchema, type EnvironmentInput, tcpPortSchema } from "./base-env.js";

const webEnvSchema = baseEnvSchema.extend({
  WEB_PORT: tcpPortSchema.default(3000),
  API_INTERNAL_URL: z.url().default("http://api:5000"),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function parseWebEnv(input: EnvironmentInput): WebEnv {
  return webEnvSchema.parse(input);
}
