import { describe, expect, it } from "vitest";

import { evaluateHealthCircuit } from "./circuit-breaker.js";

const degraded = {
  publicPage: "TIMEOUT" as const,
  ytdlp: "YTDLP_ERROR" as const,
  rss: "NETWORK_ERROR" as const,
};
const healthy = {
  publicPage: "PUBLIC_PAGE_RENDERED" as const,
  ytdlp: "YTDLP_OK" as const,
  rss: "RSS_OK" as const,
};

describe("health circuit breaker", () => {
  it("opens for a mass provider incident and pauses deletion", () => {
    const result = evaluateHealthCircuit([
      ...Array.from({ length: 18 }, () => degraded),
      healthy,
      healthy,
    ]);
    expect(result).toMatchObject({ open: true, samples: 20, failures: 18 });
    expect(result.failureRatio).toBe(0.9);
  });

  it("does not open before the minimum sample size", () => {
    const result = evaluateHealthCircuit(Array.from({ length: 9 }, () => degraded));
    expect(result.open).toBe(false);
  });

  it("does not classify explicit not-found evidence as a provider incident", () => {
    const result = evaluateHealthCircuit([
      ...Array.from({ length: 10 }, () => ({
        publicPage: "PUBLIC_PAGE_NOT_FOUND" as const,
        ytdlp: "YTDLP_NOT_FOUND" as const,
        rss: "RSS_MISSING" as const,
      })),
    ]);
    expect(result.failures).toBe(0);
    expect(result.open).toBe(false);
  });
});
