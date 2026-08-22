import type { DeploymentMode } from "@yt-monitor/auth";

export interface ApiEnvironmentPort {
  APP_ALLOWED_ORIGINS: readonly string[];
  DEPLOYMENT_MODE: DeploymentMode;
}

export const API_ENV = Symbol("API_ENV");
