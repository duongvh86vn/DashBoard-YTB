import { describe, expect, it, vi } from "vitest";
import { NvidiaProvider } from "./nvidia.js";
import { channelClassificationSchema } from "./schemas.js";

function chatResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status });
}

describe("NVIDIA OpenAI-compatible provider", () => {
  it("discovers models without hard-coding a vendor model ID", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ id: "provider/custom-model", owned_by: "nvidia" }] }),
        ),
      );
    const provider = new NvidiaProvider({
      apiKey: "nv-key",
      baseUrl: "https://nim.test/v1",
      fetch,
    });
    await expect(provider.models()).resolves.toEqual([
      {
        id: "provider/custom-model",
        label: "provider/custom-model",
        ownedBy: "nvidia",
        source: "DISCOVERED",
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://nim.test/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("validates structured JSON and retries one repair", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(chatResponse("not json"))
      .mockResolvedValueOnce(
        chatResponse(
          JSON.stringify({
            primaryNiche: "tech",
            subNiches: [],
            language: "vi",
            contentFormat: "review",
            confidence: 0.9,
          }),
        ),
      );
    const provider = new NvidiaProvider({ apiKey: "nv-key", model: "provider/model", fetch });
    await expect(
      provider.structured({
        taskType: "channel",
        prompt: "classify",
        schema: channelClassificationSchema,
      }),
    ).resolves.toMatchObject({ primaryNiche: "tech" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("maps 429, invalid credentials and missing model safely", async () => {
    const limited = new NvidiaProvider({
      apiKey: "nv-key",
      model: "provider/model",
      fetch: vi.fn().mockResolvedValue(chatResponse("", 429)),
    });
    await expect(limited.text({ taskType: "analysis", prompt: "x" })).rejects.toMatchObject({
      code: "AI_RATE_LIMITED",
      retryable: true,
    });
    const rejected = new NvidiaProvider({
      apiKey: "nv-key",
      model: "provider/model",
      fetch: vi.fn().mockResolvedValue(chatResponse("", 401)),
    });
    await expect(rejected.text({ taskType: "analysis", prompt: "x" })).rejects.toMatchObject({
      code: "AI_CONFIGURATION_INVALID",
    });
    const missing = new NvidiaProvider({ apiKey: "nv-key", fetch: vi.fn() });
    await expect(missing.text({ taskType: "analysis", prompt: "x" })).rejects.toMatchObject({
      code: "AI_CONFIGURATION_INVALID",
    });
  });

  it("reports disabled state without a key", async () => {
    await expect(new NvidiaProvider({}).health()).resolves.toMatchObject({
      provider: "NVIDIA",
      status: "DISABLED",
      code: "AI_DISABLED",
    });
  });
});
