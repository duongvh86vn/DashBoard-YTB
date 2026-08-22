import { chromium } from "playwright-core";

export interface AnonymousBrowserOptions {
  executablePath?: string;
  timeoutMs?: number;
  locale?: string;
  userAgent?: string;
}

export interface AnonymousBrowserContext {
  newPage(): Promise<AnonymousPage>;
  close(): Promise<void>;
}

export interface AnonymousPage {
  goto(
    url: string,
    options?: { timeout?: number; waitUntil?: "domcontentloaded" | "load" | "networkidle" },
  ): Promise<{ status(): number | null } | null>;
  title(): Promise<string>;
  url(): string;
  locator(selector: string): { innerText(options?: { timeout?: number }): Promise<string> };
  close(): Promise<void>;
}

export type AnonymousBrowserContextFactory = () => Promise<AnonymousBrowserContext>;

export function createAnonymousBrowserContextFactory(
  options: AnonymousBrowserOptions = {},
): AnonymousBrowserContextFactory {
  return async () => {
    const launchOptions = {
      headless: true,
      timeout: options.timeoutMs ?? 15_000,
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    };
    const browser = await chromium.launch(launchOptions);
    const contextOptions = {
      locale: options.locale ?? "en-US",
      ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    };
    const context = await browser.newContext(contextOptions);
    return {
      newPage: () => context.newPage(),
      close: async () => {
        await context.close();
        await browser.close();
      },
    };
  };
}
