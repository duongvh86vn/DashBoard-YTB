import { ArgumentsHost, BadRequestException, Catch, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";

import { AuthApplicationError } from "./auth-application.error.js";
import { UserApplicationError } from "../users/user-application.error.js";
import { ChannelApplicationError } from "../channels/channel-application.error.js";

@Catch(AuthApplicationError, UserApplicationError, ChannelApplicationError, BadRequestException)
export class AuthApplicationExceptionFilter implements ExceptionFilter {
  catch(
    exception:
      AuthApplicationError | UserApplicationError | ChannelApplicationError | BadRequestException,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.set("Cache-Control", "no-store");

    if (exception instanceof AuthApplicationError) {
      if (exception.retryAfterSeconds !== undefined) {
        response.set("Retry-After", String(exception.retryAfterSeconds));
      }
      response.status(exception.status).json(exception.body);
      return;
    }

    if (exception instanceof UserApplicationError) {
      response.status(exception.status).json(exception.body);
      return;
    }

    if (exception instanceof ChannelApplicationError) {
      response.status(exception.status).json(exception.body);
      return;
    }

    response.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request" },
    });
  }
}
