export type DeploymentMode = "LOCAL" | "PUBLIC";

export interface AuthEnvironment {
  DEPLOYMENT_MODE: DeploymentMode;
  APP_PUBLIC_URL: string;
  APP_ALLOWED_ORIGINS: string[];
  SESSION_SECRET: string;
  SESSION_IDLE_MINUTES: number;
  SESSION_ABSOLUTE_HOURS: number;
  LOGIN_MAX_ATTEMPTS: number;
  LOGIN_LOCK_MINUTES: number;
}

export type UserRoleValue = "ADMIN" | "VIEWER";

export interface PublicUser {
  id: string;
  email: string;
  role: UserRoleValue;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export type AuthErrorCode =
  | "AUTH_UNAUTHENTICATED"
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_FORBIDDEN"
  | "AUTH_CSRF_INVALID"
  | "AUTH_RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "USER_NOT_FOUND"
  | "USER_ALREADY_EXISTS";

export const SESSION_COOKIE_LOCAL = "yhm_session";
export const SESSION_COOKIE_PUBLIC = "__Host-yhm_session";
export const CSRF_HEADER_NAME = "x-csrf-protection";
