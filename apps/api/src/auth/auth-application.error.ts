import type { AuthErrorCode } from "@yt-monitor/auth";

type ApplicationAuthCode = Extract<AuthErrorCode, "AUTH_INVALID_CREDENTIALS" | "AUTH_RATE_LIMITED">;

export class AuthApplicationError extends Error {
  private constructor(
    readonly status: 401 | 429,
    readonly code: ApplicationAuthCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AuthApplicationError";
  }

  get body() {
    return { error: { code: this.code, message: this.message } } as const;
  }

  static invalidLogin(): AuthApplicationError {
    return new AuthApplicationError(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
  }

  static invalidCurrentPassword(): AuthApplicationError {
    return new AuthApplicationError(
      401,
      "AUTH_INVALID_CREDENTIALS",
      "Current password is incorrect",
    );
  }

  static rateLimited(blockedUntil: Date, now: Date): AuthApplicationError {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((blockedUntil.getTime() - now.getTime()) / 1_000),
    );
    return new AuthApplicationError(
      429,
      "AUTH_RATE_LIMITED",
      "Too many login attempts",
      retryAfterSeconds,
    );
  }
}
