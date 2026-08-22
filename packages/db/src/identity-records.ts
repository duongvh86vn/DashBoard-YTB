import type {
  AuditAction,
  AuditLog,
  AuditOutcome,
  LoginThrottleScope,
  Session,
  User,
  UserRole,
} from "./generated/prisma/client.js";

export type UserRoleValue = UserRole;
export type LoginThrottleScopeValue = LoginThrottleScope;
export type AuditActionValue = AuditAction;
export type AuditOutcomeValue = AuditOutcome;

export type UserRecord = User;
export type SessionRecord = Session;
export type AuditLogRecord = AuditLog;

export type SessionUserRecord = Omit<UserRecord, "passwordHash">;

export interface UsableSessionRecord extends SessionRecord {
  user: SessionUserRecord;
}

export type AuditMetadata = Record<string, string | number | boolean | null>;
