import { parseWebEnv } from "@yt-monitor/config";

import { createWebHealthResponse } from "../../lib/create-health-response";

export function GET(): Response {
  const env = parseWebEnv(process.env);
  return Response.json(createWebHealthResponse(env.APP_VERSION), {
    headers: { "Cache-Control": "no-store" },
  });
}
