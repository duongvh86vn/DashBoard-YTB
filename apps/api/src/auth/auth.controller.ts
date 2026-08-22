import { Body, Controller, Get, Header, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";

import { AUTH_APPLICATION_PORT, type AuthApplicationPort } from "./auth-application.port.js";
import { parseChangePasswordBody, parseLoginBody, parseLogoutBody } from "./auth.schemas.js";
import { Public } from "./public.decorator.js";
import type { AuthenticatedRequest } from "./request-user.js";
import { SessionCookieService } from "./session-cookie.service.js";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AUTH_APPLICATION_PORT) private readonly auth: AuthApplicationPort,
    private readonly cookies: SessionCookieService,
  ) {}

  @Post("login")
  @Public()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: Awaited<ReturnType<AuthApplicationPort["login"]>>["user"] }> {
    const input = parseLoginBody(body);
    const result = await this.auth.login(input);
    this.cookies.set(response, result.sessionToken);
    return { user: result.user };
  }

  @Post("logout")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async logout(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    parseLogoutBody(body);
    await this.auth.logout({ userId: request.user.id, sessionId: request.session.id });
    this.cookies.clear(response);
  }

  @Get("me")
  @Header("Cache-Control", "no-store")
  me(@Req() request: AuthenticatedRequest) {
    return { user: request.user };
  }

  @Post("change-password")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async changePassword(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const input = parseChangePasswordBody(body);
    await this.auth.changePassword({ userId: request.user.id, ...input });
    this.cookies.clear(response);
  }
}
