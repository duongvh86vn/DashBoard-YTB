import { describe, expect, it } from "vitest";

import { assertHealthResponse } from "./health-response-assertion.js";

const disabledBody = {
  status: "disabled",
  service: "ai",
  version: "0.1.0",
  timestamp: "2026-08-21T00:00:00.000Z",
  checks: { ai: { status: "disabled", required: false, code: "AI_DISABLED" } },
};

describe("assertHealthResponse", () => {
  it("accepts the expected HTTP, service and component status", () => {
    expect(
      assertHealthResponse(
        { status: 200, headers: new Headers({ "Cache-Control": "no-store" }) },
        disabledBody,
        200,
        "ai",
        "disabled",
      ),
    ).toMatchObject({ service: "ai", status: "disabled" });
  });

  it("rejects a disabled component that claims to be healthy", () => {
    expect(() =>
      assertHealthResponse(
        { status: 200, headers: new Headers({ "Cache-Control": "no-store" }) },
        { ...disabledBody, status: "ok" },
        200,
        "ai",
        "disabled",
      ),
    ).toThrow("Expected health status disabled, received ok");
  });

  it("requires the expected stable dependency failure code", () => {
    const workerFailure = {
      ...disabledBody,
      service: "worker",
      status: "unavailable",
      checks: {
        worker: {
          status: "unavailable",
          required: true,
          code: "WORKER_HEARTBEAT_STALE",
        },
      },
    };

    expect(
      assertHealthResponse(
        { status: 503, headers: new Headers({ "Cache-Control": "no-store" }) },
        workerFailure,
        503,
        "worker",
        "unavailable",
        { checkName: "worker", code: "WORKER_HEARTBEAT_STALE" },
      ),
    ).toMatchObject({ checks: { worker: { code: "WORKER_HEARTBEAT_STALE" } } });

    expect(() =>
      assertHealthResponse(
        { status: 503, headers: new Headers({ "Cache-Control": "no-store" }) },
        workerFailure,
        503,
        "worker",
        "unavailable",
        { checkName: "worker", code: "WORKER_HEALTHCHECK_FAILED" },
      ),
    ).toThrow("Expected check worker code WORKER_HEALTHCHECK_FAILED");
  });
});
