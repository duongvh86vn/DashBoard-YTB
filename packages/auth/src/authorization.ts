import type { UserRoleValue } from "./contracts.js";

export function canManageUsers(role: UserRoleValue): boolean {
  return role === "ADMIN";
}
