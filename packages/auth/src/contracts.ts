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

export {
  CSRF_HEADER_NAME,
  type AuthErrorCode,
  type PublicUser,
  type UserRoleValue,
} from "@yt-monitor/shared/browser-auth";

export const SESSION_COOKIE_LOCAL = "yhm_session";
export const SESSION_COOKIE_PUBLIC = "__Host-yhm_session";
