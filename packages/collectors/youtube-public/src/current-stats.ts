import type { CanonicalChannel, ChannelCurrentStats } from "@yt-monitor/shared";

import {
  createAnonymousBrowserContextFactory,
  type AnonymousBrowserContextFactory,
  type AnonymousBrowserOptions,
} from "./browser-context.js";
import { detectPublicPage } from "./detectors.js";
import { parsePublicPageMetrics } from "./metrics.js";
import type { RenderedPublicPage } from "./render.js";
import { fetchPublicPage, type PublicPageFetchOptions } from "./resolve-channel.js";

export interface PublicCurrentStatsOptions extends AnonymousBrowserOptions, PublicPageFetchOptions {
  contextFactory?: AnonymousBrowserContextFactory;
  now?: () => Date;
  renderWaitMs?: number;
  pollIntervalMs?: number;
}

function statsTextReady(value: string): boolean {
  const moreInfo = value.lastIndexOf("More info");
  if (moreInfo < 0) return false;
  const about = value.slice(moreInfo);
  return (
    /\bsubscribers?\b/iu.test(about) && /\bvideos?\b/iu.test(about) && /\bviews?\b/iu.test(about)
  );
}

async function delay(durationMs: number): Promise<void> {
  if (durationMs <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}

/** Separate from the health renderer: it waits for YouTube hydration and keeps a bounded tail. */
async function renderPublicStatsPage(
  url: string,
  options: PublicCurrentStatsOptions,
): Promise<RenderedPublicPage> {
  const startedAt = Date.now();
  const context = await (options.contextFactory ?? createAnonymousBrowserContextFactory(options))();
  let page: Awaited<ReturnType<typeof context.newPage>> | null = null;
  try {
    page = await context.newPage();
    const response = await page.goto(url, {
      timeout: options.timeoutMs ?? 20_000,
      waitUntil: "domcontentloaded",
    });
    const title = (await page.title()).slice(0, 512);
    const deadline = Date.now() + (options.renderWaitMs ?? 5_000);
    let visibleText = "";
    do {
      try {
        visibleText = await page.locator("body").innerText({ timeout: 2_000 });
      } catch {
        // A hydration poll may race navigation; retry until the bounded deadline.
      }
      if (statsTextReady(visibleText) || Date.now() >= deadline) break;
      await delay(options.pollIntervalMs ?? 250);
    } while (Date.now() < deadline);

    // The canonical More info block is at the end of the page; keep enough trailing
    // context without retaining or returning the full rendered document.
    visibleText = visibleText.slice(-32_768);
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

export function parsePublicChannelAboutText(visibleText: string): ParsedAboutMetrics {
  const marker = visibleText.lastIndexOf("More info");
  if (marker < 0) {
    const header = parsePublicPageMetrics(visibleText);
    // A generic channel page contains many video view counters. Without the
    // canonical More info boundary, lifetime views are intentionally unknown.
    return { ...header, lifetimeViewCount: null };
  }
  return parsePublicPageMetrics(visibleText.slice(marker));
}

interface ParsedAboutMetrics {
  subscriberCount: bigint | null;
  videoCount: bigint | null;
  lifetimeViewCount: bigint | null;
}

type MetricKey = keyof ParsedAboutMetrics;

const METRIC_KEYS: readonly MetricKey[] = ["subscriberCount", "videoCount", "lifetimeViewCount"];

function hasMetric(metrics: ParsedAboutMetrics | null): metrics is ParsedAboutMetrics {
  return (
    metrics !== null &&
    (metrics.subscriberCount !== null ||
      metrics.videoCount !== null ||
      metrics.lifetimeViewCount !== null)
  );
}

function hasEveryMetric(metrics: ParsedAboutMetrics | null): metrics is ParsedAboutMetrics {
  return metrics !== null && METRIC_KEYS.every((key) => metrics[key] !== null);
}

function mergeMetrics(
  preferred: ParsedAboutMetrics | null,
  fallback: ParsedAboutMetrics | null,
): ParsedAboutMetrics | null {
  if (preferred === null) return fallback;
  if (fallback === null) return preferred;
  return {
    subscriberCount: preferred.subscriberCount ?? fallback.subscriberCount,
    videoCount: preferred.videoCount ?? fallback.videoCount,
    lifetimeViewCount: preferred.lifetimeViewCount ?? fallback.lifetimeViewCount,
  };
}

function decodeJsonString(value: string): string | null {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return null;
  }
}

function aboutText(fragment: string, field: string): string | null {
  const match = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "u").exec(fragment);
  return match?.[1] ? decodeJsonString(match[1]) : null;
}

/** Parses only the aboutChannelViewModel, never a video's similarly named counters. */
export function parsePublicChannelAboutHtml(
  html: string,
  expectedChannelId: string,
): ParsedAboutMetrics | null {
  // YouTube also lists renderer names during bootstrap. Match the concrete
  // model object so the type-list occurrence cannot shadow the real payload.
  const start = html.indexOf('"aboutChannelViewModel":{');
  if (start < 0) return null;
  const end = html.indexOf('"shareChannel"', start);
  const fragment = html.slice(start, end > start ? end : start + 100_000);
  if (aboutText(fragment, "channelId") !== expectedChannelId) return null;
  const text = [
    aboutText(fragment, "subscriberCountText"),
    aboutText(fragment, "videoCountText"),
    aboutText(fragment, "viewCountText"),
  ]
    .filter((value): value is string => value !== null)
    .join("\n");
  return parsePublicPageMetrics(text);
}

function aboutUrl(canonicalUrl: string): string {
  const url = new URL(canonicalUrl);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/about`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function pageTitle(value: string): string | null {
  const normalized = value.replace(/\s+-\s+YouTube\s*$/iu, "").trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Collects only metrics rendered by the anonymous public channel page. Missing
 * fields remain null and a page without any reliable metric is not persisted.
 */
export async function collectPublicChannelCurrentStats(
  channel: CanonicalChannel,
  options: PublicCurrentStatsOptions = {},
): Promise<ChannelCurrentStats | null> {
  const url = aboutUrl(channel.canonicalUrl);
  const capturedAt = (options.now ?? (() => new Date()))();
  // An injected browser context traditionally means a render-only unit test.
  // When a fetch implementation is also injected, exercise the production
  // HTML-plus-render enrichment path without making a real network request.
  const html =
    options.contextFactory && options.fetchImpl === undefined
      ? null
      : await fetchPublicPage(url, options);
  const htmlMetrics =
    html === null ? null : parsePublicChannelAboutHtml(html, channel.youtubeChannelId);
  let renderedMetrics: ParsedAboutMetrics | null = null;
  let renderedTitle: string | null = null;

  if (!hasEveryMetric(htmlMetrics)) {
    try {
      const page = await renderPublicStatsPage(url, options);
      const detection = detectPublicPage(page);
      if (detection.kind === "RENDERED" && detection.channelId === channel.youtubeChannelId) {
        renderedMetrics = parsePublicChannelAboutText(page.visibleText);
        renderedTitle = pageTitle(page.title);
      }
    } catch (error) {
      // A partial structured About model is still reliable. Do not discard its
      // available counters merely because optional browser enrichment failed.
      if (!hasMetric(htmlMetrics)) throw error;
    }
  }

  const metrics = mergeMetrics(htmlMetrics, renderedMetrics);
  if (!hasMetric(metrics)) return null;

  const sourceDetails: NonNullable<ChannelCurrentStats["sourceDetails"]> = {};
  const metricSource = (key: MetricKey) =>
    htmlMetrics?.[key] !== null && htmlMetrics?.[key] !== undefined
      ? "YOUTUBE_PUBLIC_ABOUT_HTML"
      : "YOUTUBE_PUBLIC_ABOUT_RENDER";
  const exactProvenance = (key: MetricKey) => ({
    source: metricSource(key),
    capturedAt: capturedAt.toISOString(),
    metricClass: "PUBLIC_CURRENT" as const,
    precision: "EXACT_AS_PUBLISHED" as const,
    scope: "PUBLIC_ONLY" as const,
  });
  const publicDisplayProvenance = (key: MetricKey) => {
    const provenance = exactProvenance(key);
    return {
      ...provenance,
      precision:
        provenance.source === "YOUTUBE_PUBLIC_ABOUT_RENDER"
          ? ("ROUNDED_PUBLIC_DISPLAY" as const)
          : provenance.precision,
    };
  };
  if (metrics.subscriberCount !== null) {
    sourceDetails.subscriberCount = {
      ...exactProvenance("subscriberCount"),
      precision: "ROUNDED_3_SIGNIFICANT_DIGITS",
    };
  }
  if (metrics.videoCount !== null) {
    sourceDetails.videoCount = publicDisplayProvenance("videoCount");
  }
  if (metrics.lifetimeViewCount !== null) {
    sourceDetails.lifetimeViewCount = publicDisplayProvenance("lifetimeViewCount");
  }

  return {
    subscriberCount: metrics.subscriberCount,
    videoCount: metrics.videoCount,
    lifetimeViewCount: metrics.lifetimeViewCount,
    lastUploadAt: null,
    title: renderedTitle ?? channel.title,
    handle: channel.handle,
    thumbnail: null,
    source: "YOUTUBE_PUBLIC_PAGE",
    sourceDetails,
  };
}

export class YoutubePublicStatsProvider {
  constructor(private readonly options: PublicCurrentStatsOptions = {}) {}

  getChannelCurrentStats(channel: CanonicalChannel): Promise<ChannelCurrentStats | null> {
    return collectPublicChannelCurrentStats(channel, this.options);
  }
}
