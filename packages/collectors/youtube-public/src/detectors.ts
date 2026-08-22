import { CanonicalChannelIdSchema } from "@yt-monitor/shared";

import type { RenderedPublicPage } from "./render.js";

export type PublicPageDetection =
  | { kind: "RENDERED"; channelId: string | null }
  | { kind: "NOT_FOUND"; channelId: null }
  | { kind: "TERMINATED"; channelId: null }
  | { kind: "BLOCKED"; channelId: null }
  | { kind: "CHECK_FAILED"; channelId: null };

const BLOCKED_PATTERN =
  /captcha|unusual traffic|verify you are human|access denied|temporarily unavailable|429/iu;
const TERMINATED_PATTERN =
  /channel (?:has been )?terminated|account suspended|channel removed|channel closed/iu;
const NOT_FOUND_PATTERN =
  /this page isn't available|couldn't find this channel|channel does not exist|page not found|\b404\b/iu;
const CHANNEL_ID_PATTERN = /(?:channel_id["'=:\s]+|\/channel\/)(UC[A-Za-z0-9_-]{22})/u;

export function detectPublicPage(page: RenderedPublicPage): PublicPageDetection {
  const text = `${page.title}\n${page.visibleText}`;
  if (page.httpStatus === 429 || page.httpStatus === 403 || BLOCKED_PATTERN.test(text)) {
    return { kind: "BLOCKED", channelId: null };
  }
  if (TERMINATED_PATTERN.test(text)) return { kind: "TERMINATED", channelId: null };
  if (page.httpStatus === 404 || NOT_FOUND_PATTERN.test(text)) {
    return { kind: "NOT_FOUND", channelId: null };
  }
  const channelId = CHANNEL_ID_PATTERN.exec(`${page.finalUrl}\n${text}`)?.[1] ?? null;
  if (channelId && CanonicalChannelIdSchema.safeParse(channelId).success) {
    return { kind: "RENDERED", channelId };
  }
  return { kind: "CHECK_FAILED", channelId: null };
}
