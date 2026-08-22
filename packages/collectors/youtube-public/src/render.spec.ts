import { describe, expect, it, vi } from "vitest";

import { renderPublicPage } from "./render.js";

describe("public page renderer", () => {
  it("uses a fresh context, visible body text only, and closes resources", async () => {
    const closePage = vi.fn(async () => undefined);
    const closeContext = vi.fn(async () => undefined);
    const result = await renderPublicPage("https://www.youtube.com/@example", {
      contextFactory: async () => ({
        newPage: async () => ({
          goto: async () => ({ status: () => 200 }),
          title: async () => "Example",
          url: () => "https://www.youtube.com/channel/UC1234567890123456789012",
          locator: () => ({ innerText: async () => "1K subscribers" }),
          close: closePage,
        }),
        close: closeContext,
      }),
    });
    expect(result.visibleText).toBe("1K subscribers");
    expect(closePage).toHaveBeenCalledOnce();
    expect(closeContext).toHaveBeenCalledOnce();
  });
});
