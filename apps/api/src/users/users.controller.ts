import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/request-user.js";
import { Roles } from "../auth/roles.decorator.js";
import { USERS_APPLICATION_PORT, type UsersApplicationPort } from "./users-application.port.js";
import {
  parseCreateUserBody,
  parseEmptyActionBody,
  parseListUsersQuery,
  parseResetPasswordBody,
  parseUpdateEmailBody,
  parseUserId,
} from "./users.schemas.js";

@Controller("users")
@Roles("ADMIN")
export class UsersController {
  constructor(@Inject(USERS_APPLICATION_PORT) private readonly users: UsersApplicationPort) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@Query() query: unknown) {
    return this.users.list(parseListUsersQuery(query));
  }

  @Post()
  @Header("Cache-Control", "no-store")
  async create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = parseCreateUserBody(body);
    return { user: await this.users.create({ actorUserId: request.user.id, ...input }) };
  }

  @Patch(":id")
  @Header("Cache-Control", "no-store")
  async updateEmail(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const targetUserId = parseUserId(id);
    const input = parseUpdateEmailBody(body);
    return {
      user: await this.users.updateEmail({
        actorUserId: request.user.id,
        targetUserId,
        ...input,
      }),
    };
  }

  @Post(":id/reset-password")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async resetPassword(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const targetUserId = parseUserId(id);
    const input = parseResetPasswordBody(body);
    await this.users.resetPassword({
      actorUserId: request.user.id,
      targetUserId,
      ...input,
    });
  }

  @Post(":id/revoke-sessions")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async revokeSessions(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    parseEmptyActionBody(body);
    await this.users.revokeSessions({
      actorUserId: request.user.id,
      targetUserId: parseUserId(id),
    });
  }

  @Post(":id/disable")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async disable(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    parseEmptyActionBody(body);
    await this.users.disable({
      actorUserId: request.user.id,
      targetUserId: parseUserId(id),
      via: "DISABLE_ENDPOINT",
    });
  }

  @Post(":id/enable")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async enable(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    parseEmptyActionBody(body);
    await this.users.enable({
      actorUserId: request.user.id,
      targetUserId: parseUserId(id),
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async deleteAlias(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    parseEmptyActionBody(body);
    await this.users.disable({
      actorUserId: request.user.id,
      targetUserId: parseUserId(id),
      via: "DELETE_ALIAS",
    });
  }
}
