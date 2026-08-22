import type { AnonymousBrowserContextFactory, AnonymousPage } from "./browser-context.js";

export interface RenderedPublicPage {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  title: string;
  visibleText: string;
  durationMs: number;
}

export interface RenderPageOptions {
  timeoutMs?: number;
  contextFactory: AnonymousBrowserContextFactory;
}

export type PublicPageLike = AnonymousPage;

export async function renderPublicPage(
  url: string,
  options: RenderPageOptions,
): Promise<RenderedPublicPage> {
  const startedAt = Date.now();
  const context = await options.contextFactory();
  let page: PublicPageLike | null = null;
  try {
    page = await context.newPage();
    const response = await page.goto(url, {
      timeout: options.timeoutMs ?? 20_000,
      waitUntil: "domcontentloaded",
    });
    const title = (await page.title()).slice(0, 512);
    const visibleText = (await page.locator("body").innerText({ timeout: 2_000 })).slice(0, 4_096);
    return {
      requestedUrl: url,
      finalUrl: page.url(),
      httpStatus: response?.status() ?? null,
      title,
      visibleText,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await page?.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}
