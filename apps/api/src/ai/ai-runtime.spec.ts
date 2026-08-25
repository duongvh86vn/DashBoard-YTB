import { encryptSecret } from "@yt-monitor/crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAiRuntimeFactory, type AiRuntimeProviderSetting } from "./ai-runtime.js";

const encryptionKey = "11".repeat(32);

function setting(
  provider: "GEMINI" | "NVIDIA",
  input: Partial<AiRuntimeProviderSetting> = {},
): AiRuntimeProviderSetting {
  return {
    provider,
    isEnabled: true,
    apiKeyEncrypted: null,
    baseUrl: null,
    configuredModels: null,
    ...input,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI runtime settings", () => {
  it("uses the encrypted database key and selected Gemini model instead of environment values", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const runtime = createAiRuntimeFactory({
      SECRET_ENCRYPTION_KEY: encryptionKey,
      GEMINI_API_KEY: "environment-key",
      GEMINI_ANALYSIS_MODEL: "environment-model",
    })({
      settings: [
        setting("GEMINI", {
          apiKeyEncrypted: encryptSecret("database-key", encryptionKey),
          configuredModels: { ANALYSIS: "database-model" },
        }),
      ],
      roles: [],
    });

    const health = await runtime.provider.health();

    expect(health).toMatchObject({
      provider: "GEMINI",
      status: "HEALTHY",
      model: "database-model",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/database-model");
    expect(url).not.toContain("database-key");
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("database-key");
    expect(runtime.configured.GEMINI).toBe(true);
  });

  it("keeps a configured provider disabled without making a network request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const runtime = createAiRuntimeFactory({ SECRET_ENCRYPTION_KEY: encryptionKey })({
      settings: [
        setting("GEMINI", {
          isEnabled: false,
          apiKeyEncrypted: encryptSecret("database-key", encryptionKey),
        }),
      ],
      roles: [],
    });

    const health = await runtime.provider.health();

    expect(health).toMatchObject({ status: "DISABLED", code: "AI_DISABLED" });
    expect(runtime.configured.GEMINI).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses a bundled recommended model when a key is saved without an exact model ID", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const runtime = createAiRuntimeFactory({ SECRET_ENCRYPTION_KEY: encryptionKey })({
      settings: [
        setting("GEMINI", {
          apiKeyEncrypted: encryptSecret("database-key", encryptionKey),
        }),
      ],
      roles: [],
    });

    const health = await runtime.provider.health();

    expect(health).toMatchObject({ status: "HEALTHY", model: "gemini-3.1-flash-lite" });
  });

  it("uses the persisted NVIDIA key for provider model discovery", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "publisher/model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const runtime = createAiRuntimeFactory({ SECRET_ENCRYPTION_KEY: encryptionKey })({
      settings: [
        setting("NVIDIA", {
          apiKeyEncrypted: encryptSecret("nvidia-database-key", encryptionKey),
          baseUrl: "https://nvidia.example/v1",
        }),
      ],
      roles: [],
    });

    const router = runtime.provider as typeof runtime.provider & {
      models(provider: "NVIDIA"): Promise<Array<{ id: string }>>;
    };
    await expect(router.models("NVIDIA")).resolves.toEqual([
      expect.objectContaining({ id: "publisher/model" }),
    ]);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://nvidia.example/v1/models");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer nvidia-database-key");
  });
});
