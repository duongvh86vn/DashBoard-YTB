import { encryptSecret } from "@yt-monitor/crypto";
import { describe, expect, it, vi } from "vitest";

import { loadWorkerAiRuntime } from "./runtime.js";

function unitOfWork(settings: unknown[], roles: unknown[] = []) {
  const repositories = {
    ai: {
      listProviderSettings: vi.fn().mockResolvedValue(settings),
      listModelRoles: vi.fn().mockResolvedValue(roles),
    },
  };
  return {
    transaction: vi.fn(async (work: (input: typeof repositories) => unknown) => work(repositories)),
  } as never;
}

describe("loadWorkerAiRuntime", () => {
  it("keeps no-AI mode explicit when no provider has a key", async () => {
    const runtime = await loadWorkerAiRuntime({ unitOfWork: unitOfWork([]), environment: {} });
    expect(runtime.enabled).toBe(false);
  });

  it("loads an encrypted database key and prioritizes the configured provider", async () => {
    const encryptionKey = Buffer.alloc(32, 7).toString("base64");
    const runtime = await loadWorkerAiRuntime({
      unitOfWork: unitOfWork([
        {
          provider: "NVIDIA",
          isEnabled: true,
          priority: 0,
          baseUrl: "https://example.invalid/v1",
          apiKeyEncrypted: encryptSecret("nvidia-key", encryptionKey),
          configuredModels: { ANALYSIS: "vendor/model" },
        },
      ]),
      environment: { SECRET_ENCRYPTION_KEY: encryptionKey },
    });
    expect(runtime.enabled).toBe(true);
    expect(runtime.provider.id).toBe("NVIDIA");
  });

  it("lets an explicit disabled database setting override a bootstrap environment key", async () => {
    const runtime = await loadWorkerAiRuntime({
      unitOfWork: unitOfWork([
        {
          provider: "GEMINI",
          isEnabled: false,
          priority: 0,
          baseUrl: null,
          apiKeyEncrypted: null,
          configuredModels: null,
        },
      ]),
      environment: { GEMINI_API_KEY: "bootstrap-key" },
    });
    expect(runtime.enabled).toBe(false);
  });
});
