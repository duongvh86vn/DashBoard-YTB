import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRoleValue } from "@yt-monitor/auth";

import { AuthPolicyError } from "./auth-policy.error.js";
import { PUBLIC_METADATA_KEY } from "./public.decorator.js";
import type { AuthenticatedRequest } from "./request-user.js";
import { ROLES_METADATA_KEY } from "./roles.decorator.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    ) {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<readonly UserRoleValue[]>(ROLES_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles === undefined) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Partial<AuthenticatedRequest>>();
    if (!request.user) {
      throw AuthPolicyError.unauthenticated();
    }

    if (!roles.includes(request.user.role)) {
      throw AuthPolicyError.forbidden();
    }

    return true;
  }
}
