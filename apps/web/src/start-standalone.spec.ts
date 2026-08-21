import { describe, expect, it, vi } from "vitest";

import { startStandaloneServer } from "../start-standalone.mjs";

describe("standalone Web startup", () => {
  it("rejects invalid runtime configuration before loading the Next server", async () => {
    const loadServer = vi.fn(async () => undefined);

    await expect(
      startStandaloneServer({
        environment: { API_INTERNAL_URL: "not-a-valid-url", NODE_ENV: "production" },
        loadServer,
      }),
    ).rejects.toThrow();

    expect(loadServer).not.toHaveBeenCalled();
  });

  it("loads the Next server after runtime configuration passes validation", async () => {
    const loadServer = vi.fn(async () => undefined);

    await startStandaloneServer({
      environment: { API_INTERNAL_URL: "http://api:5000", NODE_ENV: "production" },
      loadServer,
    });

    expect(loadServer).toHaveBeenCalledOnce();
  });
});
