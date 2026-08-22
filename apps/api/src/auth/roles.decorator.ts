import { SetMetadata } from "@nestjs/common";
import type { UserRoleValue } from "@yt-monitor/auth";

export const ROLES_METADATA_KEY = Symbol("ROLES_METADATA_KEY");

export const Roles = (...roles: readonly [UserRoleValue, ...UserRoleValue[]]) =>
  SetMetadata(ROLES_METADATA_KEY, roles);
