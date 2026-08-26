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
  Put,
  Req,
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/request-user.js";
import { Roles } from "../auth/roles.decorator.js";
import {
  CHANNEL_GROUPS_APPLICATION_PORT,
  type ChannelGroupsApplicationPort,
} from "./channel-groups-application.port.js";
import {
  parseChannelGroupId,
  parseCreateChannelGroupBody,
  parseReplaceChannelsBody,
  parseReplaceViewerGroupsBody,
  parseUpdateChannelGroupBody,
} from "./channel-groups.schemas.js";

@Controller("channel-groups")
@Roles("ADMIN")
export class ChannelGroupsController {
  constructor(
    @Inject(CHANNEL_GROUPS_APPLICATION_PORT)
    private readonly groups: ChannelGroupsApplicationPort,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list() {
    return this.groups.list();
  }

  @Get("accessible")
  @Roles("ADMIN", "VIEWER")
  @Header("Cache-Control", "no-store")
  accessible(@Req() request: AuthenticatedRequest) {
    return this.groups.listAccessible({ subject: request.user });
  }

  @Get(":id")
  @Header("Cache-Control", "no-store")
  get(@Param("id") id: string) {
    return this.groups.get({ id: parseChannelGroupId(id) });
  }

  @Post()
  @Header("Cache-Control", "no-store")
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.groups.create({
      actorUserId: request.user.id,
      ...parseCreateChannelGroupBody(body),
    });
  }

  @Patch(":id")
  @Header("Cache-Control", "no-store")
  update(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.groups.update({
      actorUserId: request.user.id,
      id: parseChannelGroupId(id),
      ...parseUpdateChannelGroupBody(body),
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async archive(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    await this.groups.archive({ actorUserId: request.user.id, id: parseChannelGroupId(id) });
  }

  @Put(":id/channels")
  @Header("Cache-Control", "no-store")
  replaceChannels(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.groups.replaceChannels({
      actorUserId: request.user.id,
      groupId: parseChannelGroupId(id),
      ...parseReplaceChannelsBody(body),
    });
  }
}

@Controller("users")
@Roles("ADMIN")
export class UserChannelGroupsController {
  constructor(
    @Inject(CHANNEL_GROUPS_APPLICATION_PORT)
    private readonly groups: ChannelGroupsApplicationPort,
  ) {}

  @Put(":id/channel-groups")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async replaceViewerGroups(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.groups.replaceViewerGroups({
      actorUserId: request.user.id,
      userId: parseChannelGroupId(id),
      ...parseReplaceViewerGroupsBody(body),
    });
  }
}
