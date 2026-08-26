export type ChannelGroupApplicationErrorCode =
  | "VALIDATION_ERROR"
  | "CHANNEL_GROUP_NOT_FOUND"
  | "CHANNEL_GROUP_ALREADY_EXISTS"
  | "CHANNEL_GROUP_MEMBERSHIP_INVALID";

export class ChannelGroupApplicationError extends Error {
  readonly body: { error: { code: ChannelGroupApplicationErrorCode; message: string } };

  private constructor(
    readonly status: 400 | 404 | 409,
    readonly code: ChannelGroupApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChannelGroupApplicationError";
    this.body = { error: { code, message } };
  }

  static validation(): ChannelGroupApplicationError {
    return new ChannelGroupApplicationError(400, "VALIDATION_ERROR", "Invalid request");
  }

  static notFound(): ChannelGroupApplicationError {
    return new ChannelGroupApplicationError(
      404,
      "CHANNEL_GROUP_NOT_FOUND",
      "Channel group not found",
    );
  }

  static alreadyExists(): ChannelGroupApplicationError {
    return new ChannelGroupApplicationError(
      409,
      "CHANNEL_GROUP_ALREADY_EXISTS",
      "A channel group with that name already exists",
    );
  }

  static membershipInvalid(): ChannelGroupApplicationError {
    return new ChannelGroupApplicationError(
      400,
      "CHANNEL_GROUP_MEMBERSHIP_INVALID",
      "Channel group membership is invalid",
    );
  }
}
