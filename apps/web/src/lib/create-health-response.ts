import type { HealthResponse } from "@yt-monitor/shared";

export function createWebHealthResponse(version: string, now = new Date()): HealthResponse {
  return {
    status: "ok",
    service: "web",
    version,
    timestamp: now.toISOString(),
    checks: { process: { status: "ok", required: true } },
  };
}
