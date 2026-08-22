import type { ChannelHealthSignalStatus, SanitizedHealthEvidence } from "@yt-monitor/shared";

import {
  createAnonymousBrowserContextFactory,
  type AnonymousBrowserOptions,
} from "./browser-context.js";
import { detectPublicPage } from "./detectors.js";
import { createHealthEvidence } from "./evidence.js";
import { renderPublicPage } from "./render.js";

export interface PublicHealthCheckResult {
  status: ChannelHealthSignalStatus;
  channelId: string | null;
  evidence: SanitizedHealthEvidence;
}

export async function checkPublicChannelHealth(
  url: string,
  options: AnonymousBrowserOptions = {},
): Promise<PublicHealthCheckResult> {
  try {
    const renderOptions = {
      contextFactory: createAnonymousBrowserContextFactory(options),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    };
    const page = await renderPublicPage(url, renderOptions);
    const detection = detectPublicPage(page);
    const status: ChannelHealthSignalStatus =
      detection.kind === "RENDERED"
        ? "PUBLIC_PAGE_RENDERED"
        : detection.kind === "NOT_FOUND"
          ? "PUBLIC_PAGE_NOT_FOUND"
          : detection.kind === "TERMINATED"
            ? "PUBLIC_PAGE_TERMINATED"
            : detection.kind === "BLOCKED"
              ? "PUBLIC_PAGE_BLOCKED"
              : "NETWORK_ERROR";
    const evidence = createHealthEvidence({
      evidenceCode:
        status === "PUBLIC_PAGE_RENDERED"
          ? "ACTIVE_PUBLIC_PAGE"
          : status === "PUBLIC_PAGE_NOT_FOUND"
            ? "NOT_FOUND_PUBLIC_PAGE"
            : status === "PUBLIC_PAGE_TERMINATED"
              ? "TERMINATED_PUBLIC_PAGE"
              : status === "PUBLIC_PAGE_BLOCKED"
                ? "BLOCKED_PUBLIC_PAGE"
                : "NETWORK_ERROR",
      text: page.title,
      httpStatus: page.httpStatus,
      durationMs: page.durationMs,
    });
    return { status, channelId: detection.channelId, evidence };
  } catch (error) {
    const status: ChannelHealthSignalStatus =
      error instanceof Error && /timeout/iu.test(error.message) ? "TIMEOUT" : "NETWORK_ERROR";
    return {
      status,
      channelId: null,
      evidence: createHealthEvidence({
        evidenceCode: status === "TIMEOUT" ? "TIMEOUT" : "NETWORK_ERROR",
        text: null,
        httpStatus: null,
        durationMs: 0,
      }),
    };
  }
}
