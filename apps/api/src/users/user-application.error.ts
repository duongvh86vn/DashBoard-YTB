import type { AuthErrorCode } from "@yt-monitor/auth";

type UserApplicationErrorCode = Extract<
  AuthErrorCode,
  | "AUTH_UNAUTHENTICATED"
  | "AUTH_FORBIDDEN"
  | "VALIDATION_ERROR"
  | "USER_NOT_FOUND"
  | "USER_ALREADY_EXISTS"
>;

export interface UserApplicationErrorBody {
  error: {
    code: UserApplicationErrorCode;
    message: string;
  };
}

export class UserApplicationError extends Error {
  readonly code: UserApplicationErrorCode;
  readonly body: UserApplicationErrorBody;

  private constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    code: UserApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UserApplicationError";
    this.code = code;
    this.body = { error: { code, message } };
  }

  static validation(): UserApplicationError {
    return new UserApplicationError(400, "VALIDATION_ERROR", "Invalid request");
  }

  static unauthenticated(): UserApplicationError {
    return new UserApplicationError(401, "AUTH_UNAUTHENTICATED", "Authentication required");
  }

  static forbidden(): UserApplicationError {
    return new UserApplicationError(403, "AUTH_FORBIDDEN", "Forbidden");
  }

  static notFound(): UserApplicationError {
    return new UserApplicationError(404, "USER_NOT_FOUND", "User not found");
  }

  static alreadyExists(): UserApplicationError {
    return new UserApplicationError(
      409,
      "USER_ALREADY_EXISTS",
      "A user with that email already exists",
    );
  }
}
