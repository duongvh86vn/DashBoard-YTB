import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/request-user.js";
import { Roles } from "../auth/roles.decorator.js";
import {
  CHANNELS_APPLICATION_PORT,
  type ChannelsApplicationPort,
} from "./channels-application.port.js";
import {
  parseChannelId,
  parseCreateChannelBody,
  parseListHealthHistoryQuery,
  parseListChannelsQuery,
  parsePublicIntelligenceQuery,
  parseListSyncRunsQuery,
} from "./channels.schemas.js";

@Controller("channels")
export class ChannelsController {
  constructor(
    @Inject(CHANNELS_APPLICATION_PORT) private readonly channels: ChannelsApplicationPort,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.channels.list({ ...parseListChannelsQuery(query), subject: request.user });
  }

  @Get("sync-runs")
  @Roles("ADMIN")
  @Header("Cache-Control", "no-store")
  syncRuns(@Query() query: unknown) {
    return this.channels.syncRuns(parseListSyncRunsQuery(query));
  }

  @Get(":id/health-history")
  @Header("Cache-Control", "no-store")
  healthHistory(
    @Param("id") id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.channels.healthHistory({
      id: parseChannelId(id),
      ...parseListHealthHistoryQuery(query),
      subject: request.user,
    });
  }

  @Post(":id/health-check")
  @Roles("ADMIN")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  requestHealthCheck(@Param("id") id: string) {
    return this.channels.requestHealthCheck({ id: parseChannelId(id) });
  }

  @Get(":id/public-intelligence")
  @Header("Cache-Control", "no-store")
  publicIntelligence(
    @Param("id") id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.channels.publicIntelligence({
      id: parseChannelId(id),
      ...parsePublicIntelligenceQuery(query),
      subject: request.user,
    });
  }

  @Get(":id")
  @Header("Cache-Control", "no-store")
  get(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.channels.get({ id: parseChannelId(id), subject: request.user });
  }

  @Post()
  @Roles("ADMIN")
  @Header("Cache-Control", "no-store")
  async create(@Body() body: unknown) {
    const channel = await this.channels.create({
      originalInput: parseCreateChannelBody(body).channelUrl,
    });
    return { channel };
  }

  @Delete(":id")
  @Roles("ADMIN")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async archive(@Param("id") id: string): Promise<void> {
    await this.channels.archive({ id: parseChannelId(id) });
  }
}
