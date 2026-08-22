import type { AuthErrorCode } from "@yt-monitor/auth";

type AuthPolicyCode = Extract<
  AuthErrorCode,
  "AUTH_UNAUTHENTICATED" | "AUTH_FORBIDDEN" | "AUTH_CSRF_INVALID"
>;

export interface AuthPolicyErrorBody {
  error: {
    code: AuthPolicyCode;
    message: string;
  };
}

export class AuthPolicyError extends Error {
  private constructor(
    readonly status: 401 | 403,
    readonly body: AuthPolicyErrorBody,
  ) {
    super(body.error.message);
    this.name = "AuthPolicyError";
  }

  static unauthenticated(): AuthPolicyError {
    return new AuthPolicyError(401, {
      error: { code: "AUTH_UNAUTHENTICATED", message: "Authentication required" },
    });
  }

  static forbidden(): AuthPolicyError {
    return new AuthPolicyError(403, {
      error: { code: "AUTH_FORBIDDEN", message: "Forbidden" },
    });
  }

  static invalidCsrf(): AuthPolicyError {
    return new AuthPolicyError(403, {
      error: { code: "AUTH_CSRF_INVALID", message: "Invalid CSRF request" },
    });
  }
}
