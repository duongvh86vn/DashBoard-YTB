import { describe, expect, it } from "vitest";

import { HealthResponseSchema } from "@yt-monitor/shared";

import { GET } from "./route.js";

describe("GET /health", () => {
  it("returns no-store JSON that satisfies the shared health schema", async () => {
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(HealthResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ service: "web", status: "ok" });
  });
});
