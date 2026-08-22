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
} from "@nestjs/common";

import { Roles } from "../auth/roles.decorator.js";
import {
  CHANNELS_APPLICATION_PORT,
  type ChannelsApplicationPort,
} from "./channels-application.port.js";
import {
  parseChannelId,
  parseCreateChannelBody,
  parseListChannelsQuery,
} from "./channels.schemas.js";

@Controller("channels")
export class ChannelsController {
  constructor(
    @Inject(CHANNELS_APPLICATION_PORT) private readonly channels: ChannelsApplicationPort,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@Query() query: unknown) {
    return this.channels.list(parseListChannelsQuery(query));
  }

  @Get(":id")
  @Header("Cache-Control", "no-store")
  get(@Param("id") id: string) {
    return this.channels.get(parseChannelId(id));
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
