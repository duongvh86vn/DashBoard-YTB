export class ChannelConflictError extends Error {
  readonly code = "CHANNEL_ALREADY_EXISTS" as const;

  constructor() {
    super("A channel with that canonical id already exists");
    this.name = "ChannelConflictError";
  }
}

export class ChannelNotFoundError extends Error {
  readonly code = "CHANNEL_NOT_FOUND" as const;

  constructor() {
    super("Channel not found");
    this.name = "ChannelNotFoundError";
  }
}

export function hasPrismaChannelErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
