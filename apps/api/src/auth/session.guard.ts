import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SESSION_COOKIE_LOCAL, SESSION_COOKIE_PUBLIC, type DeploymentMode } from "@yt-monitor/auth";
import { parseCookie } from "cookie";
import type { Request } from "express";

import { API_ENV, type ApiEnvironmentPort } from "./api-environment.port.js";
import { AuthPolicyError } from "./auth-policy.error.js";
import { PUBLIC_METADATA_KEY } from "./public.decorator.js";
import type { AuthenticatedRequest } from "./request-user.js";
import {
  SESSION_AUTHENTICATION_PORT,
  type AuthenticatedPrincipal,
  type SessionAuthenticationPort,
} from "./session-authentication.port.js";

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function activeCookieName(mode: DeploymentMode): string {
  return mode === "PUBLIC" ? SESSION_COOKIE_PUBLIC : SESSION_COOKIE_LOCAL;
}

function readSessionToken(request: Request, mode: DeploymentMode): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  let cookies: Record<string, string | undefined>;
  try {
    cookies = parseCookie(cookieHeader);
  } catch {
    return null;
  }

  const token = cookies[activeCookieName(mode)];
  return token && SESSION_TOKEN_PATTERN.test(token) ? token : null;
}

function safePrincipal(principal: AuthenticatedPrincipal): AuthenticatedPrincipal {
  return {
    user: {
      id: principal.user.id,
      email: principal.user.email,
      role: principal.user.role,
      isEnabled: principal.user.isEnabled,
      createdAt: principal.user.createdAt,
      updatedAt: principal.user.updatedAt,
      disabledAt: principal.user.disabledAt,
    },
    session: { id: principal.session.id },
  };
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(API_ENV) private readonly env: ApiEnvironmentPort,
    @Inject(SESSION_AUTHENTICATION_PORT)
    private readonly authenticator: SessionAuthenticationPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = readSessionToken(request, this.env.DEPLOYMENT_MODE);
    if (token === null) {
      throw AuthPolicyError.unauthenticated();
    }

    const principal = await this.authenticator.authenticate(token);
    if (principal === null) {
      throw AuthPolicyError.unauthenticated();
    }

    const authenticatedRequest = request as AuthenticatedRequest;
    const safe = safePrincipal(principal);
    authenticatedRequest.user = safe.user;
    authenticatedRequest.session = safe.session;
    return true;
  }
}
