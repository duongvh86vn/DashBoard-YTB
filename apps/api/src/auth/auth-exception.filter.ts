import { ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";

import { AuthPolicyError } from "./auth-policy.error.js";

@Catch(AuthPolicyError)
export class AuthExceptionFilter implements ExceptionFilter<AuthPolicyError> {
  catch(exception: AuthPolicyError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.status)
      .set("Cache-Control", "no-store")
      .json(exception.body);
  }
}
