import { describe, expect, it } from "vitest";

import { HealthResponseSchema } from "@yt-monitor/shared";

import { createWebHealthResponse } from "./create-health-response.js";

describe("Web health response", () => {
  it("returns a schema-valid process-only response", () => {
    const response = createWebHealthResponse("0.1.0", new Date("2026-08-21T00:00:00.000Z"));

    expect(response).toEqual({
      status: "ok",
      service: "web",
      version: "0.1.0",
      timestamp: "2026-08-21T00:00:00.000Z",
      checks: { process: { status: "ok", required: true } },
    });
    expect(HealthResponseSchema.safeParse(response).success).toBe(true);
  });
});
