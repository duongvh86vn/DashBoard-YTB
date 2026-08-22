import { spawn } from "node:child_process";

import { YtdlpError, normalizeYtdlpFailure } from "./errors.js";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProcessRunnerOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  executable?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

const BANNED_MEDIA_FLAGS = new Set([
  "-o",
  "--output",
  "--paths",
  "--write-thumbnail",
  "--write-subs",
  "--write-auto-subs",
  "--write-description",
  "--write-info-json",
  "--keep-video",
]);

export function assertMetadataOnlyArgs(args: readonly string[]): void {
  for (const arg of args) {
    const separator = arg.indexOf("=");
    const flag = separator >= 0 ? arg.slice(0, separator) : arg;
    if (BANNED_MEDIA_FLAGS.has(flag) || arg === "-f" || arg === "--format") {
      throw new YtdlpError("YTDLP_FAILED", "yt-dlp media download flags are not allowed");
    }
  }
}

export function runProcess(
  args: readonly string[],
  options: ProcessRunnerOptions = {},
): Promise<ProcessResult> {
  assertMetadataOnlyArgs(args);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const executable = options.executable ?? "yt-dlp";

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(executable, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(new YtdlpError("YTDLP_TIMEOUT"));
      }
    }, timeoutMs);
    const append = (current: string, chunk: Buffer): string => {
      if (Buffer.byteLength(current) + chunk.byteLength > maxOutputBytes) {
        child.kill("SIGKILL");
        throw new YtdlpError("YTDLP_FAILED", "yt-dlp output exceeded the safety limit");
      }
      return current + chunk.toString("utf8");
    };

    child.stdout.on("data", (chunk: Buffer) => {
      try {
        stdout = append(stdout, chunk);
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      try {
        stderr = append(stderr, chunk);
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      }
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error.code === "ENOENT") reject(new YtdlpError("YTDLP_NOT_FOUND"));
      else reject(normalizeYtdlpFailure(error, stderr));
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (exitCode !== 0) {
        reject(
          new YtdlpError(
            normalizeYtdlpFailure(null, stderr).code,
            "yt-dlp exited unsuccessfully",
            exitCode,
          ),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
    });
  });
}

export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new RangeError("Concurrency limit must be positive");
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      }),
    );
  }

  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}
