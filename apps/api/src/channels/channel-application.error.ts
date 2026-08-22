export type ChannelApplicationErrorCode =
  | "CHANNEL_INPUT_INVALID"
  | "CHANNEL_NOT_FOUND"
  | "CHANNEL_ALREADY_EXISTS"
  | "CHANNEL_RESOLVE_FAILED";

export interface ChannelApplicationErrorBody {
  error: {
    code: ChannelApplicationErrorCode;
    message: string;
  };
}

export class ChannelApplicationError extends Error {
  readonly body: ChannelApplicationErrorBody;

  private constructor(
    readonly status: 400 | 404 | 409 | 422,
    readonly code: ChannelApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChannelApplicationError";
    this.body = { error: { code, message } };
  }

  static validation(): ChannelApplicationError {
    return new ChannelApplicationError(400, "CHANNEL_INPUT_INVALID", "Channel input is invalid");
  }

  static notFound(): ChannelApplicationError {
    return new ChannelApplicationError(404, "CHANNEL_NOT_FOUND", "Channel not found");
  }

  static alreadyExists(): ChannelApplicationError {
    return new ChannelApplicationError(
      409,
      "CHANNEL_ALREADY_EXISTS",
      "A channel with that canonical id already exists",
    );
  }

  static resolveFailed(): ChannelApplicationError {
    return new ChannelApplicationError(
      422,
      "CHANNEL_RESOLVE_FAILED",
      "The public channel could not be resolved",
    );
  }
}
