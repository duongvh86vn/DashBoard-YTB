import { describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "./gemini.js";

function generationResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status,
  });
}

describe("Gemini provider", () => {
  it("authenticates with a header and never places the API key in the request URL", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(generationResponse(JSON.stringify({ ok: true })));
    const provider = new GeminiProvider({
      apiKey: "secret-key-that-must-not-leak",
      model: "gemini-test",
      baseUrl: "https://gemini.test/v1beta",
      fetch,
    });

    await expect(provider.text({ taskType: "test", prompt: "hello" })).resolves.toBe(
      JSON.stringify({ ok: true }),
    );

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://gemini.test/v1beta/models/gemini-test:generateContent");
    expect(String(url)).not.toContain("secret-key-that-must-not-leak");
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-goog-api-key": "secret-key-that-must-not-leak",
    });
  });

  it("discovers only models that support generateContent", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-fast",
              displayName: "Gemini Fast",
              description: "Fast generation model",
              supportedGenerationMethods: ["generateContent", "countTokens"],
            },
            {
              name: "models/gemini-embedding",
              displayName: "Gemini Embedding",
              supportedGenerationMethods: ["embedContent"],
            },
            { displayName: "Missing ID", supportedGenerationMethods: ["generateContent"] },
          ],
        }),
      ),
    );
    const provider = new GeminiProvider({
      apiKey: "secret-key",
      baseUrl: "https://gemini.test/v1beta/",
      fetch,
    });

    await expect(provider.models()).resolves.toEqual([
      {
        id: "gemini-fast",
        label: "Gemini Fast",
        description: "Fast generation model",
        ownedBy: "Google",
        source: "DISCOVERED",
      },
    ]);
    expect(fetch).toHaveBeenCalledWith("https://gemini.test/v1beta/models?pageSize=1000", {
      method: "GET",
      headers: { "x-goog-api-key": "secret-key" },
    });
  });

  it("uses header authentication for health checks", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("{}"));
    const provider = new GeminiProvider({
      apiKey: "health-key",
      model: "gemini-health",
      baseUrl: "https://gemini.test/v1beta",
      fetch,
    });

    await expect(provider.health()).resolves.toMatchObject({ status: "HEALTHY" });
    expect(fetch).toHaveBeenCalledWith(
      "https://gemini.test/v1beta/models/gemini-health",
      expect.objectContaining({
        method: "GET",
        headers: { "x-goog-api-key": "health-key" },
      }),
    );
  });

  it("reports a typed configuration error when generation has no model", async () => {
    const provider = new GeminiProvider({ apiKey: "secret-key", fetch: vi.fn() });
    await expect(provider.text({ taskType: "test", prompt: "hello" })).rejects.toMatchObject({
      code: "AI_CONFIGURATION_INVALID",
    });
  });
});
