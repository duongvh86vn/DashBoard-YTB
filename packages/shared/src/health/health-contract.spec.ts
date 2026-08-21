import { describe, expect, it } from "vitest";

import { aggregateHealthStatus, HealthResponseSchema } from "./health-contract.js";

describe("health contract", () => {
  it("reports unavailable when a required dependency is unavailable", () => {
    expect(
      aggregateHealthStatus({
        database: { status: "unavailable", required: true },
        ai: { status: "disabled", required: false },
      }),
    ).toBe("unavailable");
  });

  it("does not degrade a service for an optional disabled dependency", () => {
    expect(
      aggregateHealthStatus({
        database: { status: "ok", required: true },
        ai: { status: "disabled", required: false },
      }),
    ).toBe("ok");
  });

  it("reports a component as disabled when every check is disabled", () => {
    expect(
      aggregateHealthStatus({
        ai: { status: "disabled", required: false },
      }),
    ).toBe("disabled");
  });

  it("rejects an unknown service name", () => {
    const result = HealthResponseSchema.safeParse({
      status: "ok",
      service: "youtube",
      version: "0.1.0",
      timestamp: "2026-08-21T00:00:00.000Z",
      checks: {},
    });

    expect(result.success).toBe(false);
  });
});
