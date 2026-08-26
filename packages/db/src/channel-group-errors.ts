export class ChannelGroupConflictError extends Error {
  readonly code = "CHANNEL_GROUP_ALREADY_EXISTS" as const;

  constructor() {
    super("Channel group already exists");
    this.name = "ChannelGroupConflictError";
  }
}

export class ChannelGroupNotFoundError extends Error {
  readonly code = "CHANNEL_GROUP_NOT_FOUND" as const;

  constructor() {
    super("Channel group not found");
    this.name = "ChannelGroupNotFoundError";
  }
}

export class ChannelGroupMembershipTargetError extends Error {
  readonly code = "CHANNEL_GROUP_MEMBERSHIP_TARGET_INVALID" as const;

  constructor(readonly target: "CHANNEL" | "VIEWER" | "GROUP") {
    super(`Invalid channel group membership target: ${target}`);
    this.name = "ChannelGroupMembershipTargetError";
  }
}
