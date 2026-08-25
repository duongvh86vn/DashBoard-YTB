import { describe, expect, it } from "vitest";

import { parseProviderSettingsBody } from "./ai.schemas.js";

describe("AI settings schema", () => {
  it("normalizes a selected model and API key", () => {
    expect(
      parseProviderSettingsBody({
        provider: "GEMINI",
        apiKey: "  test-key  ",
        configuredModels: { ANALYSIS: "  gemini-model  " },
      }),
    ).toEqual({
      provider: "GEMINI",
      apiKey: "test-key",
      configuredModels: { ANALYSIS: "gemini-model" },
    });
  });

  it("rejects unknown role names instead of persisting unusable configuration", () => {
    expect(() =>
      parseProviderSettingsBody({
        provider: "NVIDIA",
        configuredModels: { TYPO_ROLE: "publisher/model" },
      }),
    ).toThrow();
  });
});
