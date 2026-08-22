import type { PublicUser } from "@yt-monitor/auth";

export interface RequestSession {
  id: string;
}

export interface AuthenticatedPrincipal {
  user: PublicUser;
  session: RequestSession;
}

export interface SessionAuthenticationPort {
  authenticate(token: string): Promise<AuthenticatedPrincipal | null>;
}

export const SESSION_AUTHENTICATION_PORT = Symbol("SESSION_AUTHENTICATION_PORT");
