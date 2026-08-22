export type YtdlpErrorCode =
  | "YTDLP_NOT_FOUND"
  | "YTDLP_TIMEOUT"
  | "YTDLP_NETWORK"
  | "YTDLP_BLOCKED"
  | "YTDLP_INVALID_JSON"
  | "YTDLP_FAILED";

export class YtdlpError extends Error {
  constructor(
    readonly code: YtdlpErrorCode,
    message = "yt-dlp operation failed",
    readonly exitCode: number | null = null,
  ) {
    super(message);
    this.name = "YtdlpError";
  }
}

export function normalizeYtdlpFailure(error: unknown, stderr = ""): YtdlpError {
  if (error instanceof YtdlpError) return error;
  const message = stderr.toLowerCase();
  if (
    message.includes("captcha") ||
    message.includes("sign in to confirm") ||
    message.includes("bot")
  ) {
    return new YtdlpError("YTDLP_BLOCKED");
  }
  if (message.includes("timed out") || message.includes("timeout")) {
    return new YtdlpError("YTDLP_TIMEOUT");
  }
  if (
    message.includes("network") ||
    message.includes("http error") ||
    message.includes("unable to download")
  ) {
    return new YtdlpError("YTDLP_NETWORK");
  }
  return new YtdlpError("YTDLP_FAILED");
}
