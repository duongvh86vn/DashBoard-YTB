export interface PublicPageMetrics {
  subscriberCount: bigint | null;
  videoCount: bigint | null;
  lifetimeViewCount: bigint | null;
}

function parseCompactNumber(value: string): bigint | null {
  const normalized = value.trim().replace(/,/gu, "").replace(/\s+/gu, "");
  const match = /^(\d+(?:\.\d+)?)([KMB])?$/iu.exec(normalized);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const multiplier =
    { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2]?.toUpperCase() ?? ""] ?? 1;
  return BigInt(Math.round(amount * multiplier));
}

function extractMetric(text: string, labels: readonly string[]): bigint | null {
  const labelPattern = labels.join("|");
  const match = new RegExp(
    `(?:^|\\n|\\s)([\\d,.]+(?:\\s*[KMB])?)\\s*(?:${labelPattern})\\b`,
    "iu",
  ).exec(text);
  return match?.[1] ? parseCompactNumber(match[1]) : null;
}

function extractSubscriberCount(text: string): bigint | null {
  const numeric = extractMetric(text, ["subscribers"]);
  if (numeric !== null) return numeric;

  // YouTube renders a genuine zero as a standalone "No subscribers" label
  // on some public channel surfaces. Keep the match line-bounded so prose or
  // a missing counter cannot be silently reclassified as zero.
  return /(?:^|\n)\s*No subscribers\s*(?:\n|$)/iu.test(text) ? 0n : null;
}

export function parsePublicPageMetrics(visibleText: string): PublicPageMetrics {
  return {
    subscriberCount: extractSubscriberCount(visibleText),
    videoCount: extractMetric(visibleText, ["videos", "video"]),
    lifetimeViewCount: extractMetric(visibleText, ["views", "view"]),
  };
}
