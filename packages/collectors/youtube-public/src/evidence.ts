import type { ChannelHealthEvidenceCode, SanitizedHealthEvidence } from "@yt-monitor/shared";

const SAFE_TEXT_MAX = 256;

export function sanitizeEvidenceText(value: string | null | undefined): string | null {
  if (!value) return null;
  const withoutControlCharacters = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f ? " " : character;
    })
    .join("");
  const sanitized = withoutControlCharacters
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, SAFE_TEXT_MAX);
  return sanitized || null;
}

export function createHealthEvidence(input: {
  evidenceCode: ChannelHealthEvidenceCode;
  text?: string | null;
  httpStatus?: number | null;
  durationMs: number;
}): SanitizedHealthEvidence {
  const httpStatus = input.httpStatus ?? null;
  return {
    evidenceCode: input.evidenceCode,
    evidenceTextSafe: sanitizeEvidenceText(input.text),
    httpStatus: Number.isInteger(httpStatus) ? httpStatus : null,
    durationMs: Math.max(0, Math.min(Math.trunc(input.durationMs), 120_000)),
  };
}
