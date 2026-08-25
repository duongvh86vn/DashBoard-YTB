import { describe, expect, it } from "vitest";
import { getBundledAiModels, getRecommendedAiModel } from "./catalog.js";

describe("bundled AI model catalog", () => {
  it("provides a human-friendly recommended model for each provider", () => {
    expect(getRecommendedAiModel("GEMINI")).toMatchObject({
      id: "gemini-3.1-flash-lite",
      label: "Gemini 3.1 Flash Lite",
      recommended: true,
      source: "BUNDLED",
    });
    expect(getRecommendedAiModel("NVIDIA")).toMatchObject({
      id: "deepseek-ai/deepseek-v4-flash",
      label: "DeepSeek V4 Flash",
      recommended: true,
      source: "BUNDLED",
    });
  });

  it("returns defensive copies instead of exposing mutable catalog state", () => {
    const first = getBundledAiModels("GEMINI");
    first[0]!.label = "changed";
    expect(getBundledAiModels("GEMINI")[0]?.label).toBe("Gemini 3.1 Flash Lite");
  });
});
