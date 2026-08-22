import { SESSION_COOKIE_LOCAL, SESSION_COOKIE_PUBLIC, type DeploymentMode } from "./contracts.js";

export interface SessionCookiePolicy {
  name: typeof SESSION_COOKIE_LOCAL | typeof SESSION_COOKIE_PUBLIC;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    path: "/";
    maxAge: number;
  };
}

export function createSessionCookiePolicy(
  mode: DeploymentMode,
  absoluteHours: number,
): SessionCookiePolicy {
  const isPublic = mode === "PUBLIC";

  return {
    name: isPublic ? SESSION_COOKIE_PUBLIC : SESSION_COOKIE_LOCAL,
    options: {
      httpOnly: true,
      secure: isPublic,
      sameSite: "lax",
      path: "/",
      maxAge: absoluteHours * 60 * 60,
    },
  };
}
