import { describe, expect, it, vi } from "vitest";
import { AnalysisCache } from "./cache.js";
import { AIProviderRouter } from "./router.js";
import { AIProviderError } from "./errors.js";
import { createAnalysisFingerprint } from "./fingerprint.js";
import { GeminiProvider } from "./gemini.js";
import { NoopAIProvider } from "./noop.js";
import { channelClassificationSchema } from "./schemas.js";

function response(text: string, status = 200): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status,
  });
}

describe("structured AI boundary", () => {
  it("rejects invalid JSON then performs one repair retry", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response("not json"))
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            primaryNiche: "tech",
            subNiches: ["ai"],
            language: "vi",
            contentFormat: "review",
            confidence: 0.8,
          }),
        ),
      );
    const provider = new GeminiProvider({ apiKey: "key", model: "gemini-test", fetch });
    const result = await provider.structured({
      taskType: "channel",
      prompt: "classify",
      schema: channelClassificationSchema,
    });
    expect(result.primaryNiche).toBe("tech");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("maps provider rate limits to a safe typed error", async () => {
    const provider = new GeminiProvider({
      apiKey: "key",
      model: "gemini-test",
      fetch: vi.fn().mockResolvedValue(response("", 429)),
    });
    await expect(provider.text({ taskType: "report", prompt: "x" })).rejects.toMatchObject({
      code: "AI_RATE_LIMITED",
      retryable: true,
    });
  });

  it("changes when the source IDs or metric summary change, regardless of object key order", () => {
    const first = createAnalysisFingerprint({
      channelId: "c1",
      timeRange: "2026-08-23",
      videoIds: ["v2", "v1"],
      metricSummary: { views: 1, delta: 2 },
      promptVersion: "v1",
    });
    const same = createAnalysisFingerprint({
      channelId: "c1",
      timeRange: "2026-08-23",
      videoIds: ["v1", "v2"],
      metricSummary: { delta: 2, views: 1 },
      promptVersion: "v1",
    });
    const changed = createAnalysisFingerprint({
      channelId: "c1",
      timeRange: "2026-08-23",
      videoIds: ["v1", "v2"],
      metricSummary: { delta: 3, views: 1 },
      promptVersion: "v1",
    });
    expect(first).toBe(same);
    expect(first).not.toBe(changed);
  });

  it("does not cache failed calls and expires successful entries", async () => {
    let now = 0;
    const cache = new AnalysisCache<string>(10, () => now);
    const factory = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue("ok");
    await expect(cache.getOrSet("fp", factory)).rejects.toThrow("down");
    await expect(cache.getOrSet("fp", factory)).resolves.toBe("ok");
    await expect(cache.getOrSet("fp", factory)).resolves.toBe("ok");
    expect(factory).toHaveBeenCalledTimes(2);
    now = 11;
    await expect(cache.getOrSet("fp", factory)).resolves.toBe("ok");
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it("uses a configured fallback only for provider failures", async () => {
    const primary = new NoopAIProvider();
    const fallback = {
      ...primary,
      structured: vi.fn().mockResolvedValue({ primaryNiche: "fallback" }),
    } as unknown as NoopAIProvider;
    const router = new AIProviderRouter(primary, fallback);
    await expect(
      router.structured({ taskType: "x", prompt: "x", schema: channelClassificationSchema }),
    ).resolves.toMatchObject({ primaryNiche: "fallback" });
    expect(fallback.structured).toHaveBeenCalled();
  });

  it("routes a configured logical role and falls back when the primary is rate limited", async () => {
    const gemini = {
      id: "GEMINI",
      health: vi.fn().mockResolvedValue({ provider: "GEMINI", status: "HEALTHY" }),
      structured: vi
        .fn()
        .mockRejectedValue(new AIProviderError("AI_RATE_LIMITED", "limited", true)),
      text: vi.fn(),
    } as unknown as NoopAIProvider;
    const nvidia = {
      id: "NVIDIA",
      health: vi.fn().mockResolvedValue({ provider: "NVIDIA", status: "HEALTHY" }),
      structured: vi.fn().mockResolvedValue({ primaryNiche: "nvidia" }),
      text: vi.fn(),
    } as unknown as NoopAIProvider;
    const router = new AIProviderRouter(gemini, nvidia);
    router.setRoles({
      FAST: { role: "FAST", provider: "GEMINI", modelId: "gemini-fast" },
      FALLBACK: { role: "FALLBACK", provider: "NVIDIA", modelId: "nvidia-fallback" },
    });
    await expect(
      router.structured({
        taskType: "CHANNEL_CLASSIFICATION",
        prompt: "x",
        schema: channelClassificationSchema,
      }),
    ).resolves.toMatchObject({ primaryNiche: "nvidia" });
    expect(nvidia.structured).toHaveBeenCalledWith(
      expect.objectContaining({ model: "nvidia-fallback" }),
    );
    expect(router.id).toBe("NVIDIA");
  });

  it("surfaces unavailable when both configured providers fail", async () => {
    const failed = (id: "GEMINI" | "NVIDIA") =>
      ({
        id,
        health: vi.fn().mockResolvedValue({ provider: id, status: "UNAVAILABLE" }),
        structured: vi.fn().mockRejectedValue(new AIProviderError("AI_UNAVAILABLE", "down", true)),
        text: vi.fn().mockRejectedValue(new AIProviderError("AI_UNAVAILABLE", "down", true)),
      }) as unknown as NoopAIProvider;
    const router = new AIProviderRouter(failed("GEMINI"), failed("NVIDIA"));
    await expect(router.text({ taskType: "report", prompt: "x" })).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
  });

  it("reports no-AI mode explicitly", async () => {
    await expect(new NoopAIProvider().health()).resolves.toMatchObject({
      status: "DISABLED",
      code: "AI_DISABLED",
    });
    await expect(new NoopAIProvider().text({ taskType: "x", prompt: "x" })).rejects.toBeInstanceOf(
      AIProviderError,
    );
  });

  it("keeps router health disabled when both providers are unconfigured", async () => {
    const router = new AIProviderRouter(new NoopAIProvider(), new NoopAIProvider());
    await expect(router.health()).resolves.toMatchObject({
      provider: "GEMINI",
      status: "DISABLED",
      code: "AI_DISABLED",
    });
  });
});
