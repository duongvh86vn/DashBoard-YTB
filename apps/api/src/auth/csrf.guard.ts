import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { CSRF_HEADER_NAME, validateCsrfRequest } from "@yt-monitor/auth";
import type { Request } from "express";

import { API_ENV, type ApiEnvironmentPort } from "./api-environment.port.js";
import { AuthPolicyError } from "./auth-policy.error.js";

function readHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(API_ENV) private readonly env: ApiEnvironmentPort) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !validateCsrfRequest({
        method: request.method,
        origin: readHeader(request, "origin"),
        contentType: readHeader(request, "content-type"),
        protectionHeader: readHeader(request, CSRF_HEADER_NAME),
        allowedOrigins: this.env.APP_ALLOWED_ORIGINS,
      })
    ) {
      throw AuthPolicyError.invalidCsrf();
    }

    return true;
  }
}
