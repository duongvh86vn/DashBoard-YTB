import { ArgumentsHost, BadRequestException, Catch, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";

import { AuthApplicationError } from "./auth-application.error.js";

@Catch(AuthApplicationError, BadRequestException)
export class AuthApplicationExceptionFilter implements ExceptionFilter {
  catch(exception: AuthApplicationError | BadRequestException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.set("Cache-Control", "no-store");

    if (exception instanceof AuthApplicationError) {
      if (exception.retryAfterSeconds !== undefined) {
        response.set("Retry-After", String(exception.retryAfterSeconds));
      }
      response.status(exception.status).json(exception.body);
      return;
    }

    response.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request" },
    });
  }
}
