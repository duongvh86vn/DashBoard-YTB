import { Controller, Get, Header, Inject, Param, Query, Req } from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/request-user.js";
import { VIDEOS_APPLICATION_PORT, type VideosApplicationPort } from "./videos-application.port.js";
import { parseUuid, parseVideosQuery } from "./videos.schemas.js";

@Controller("channels")
export class VideosController {
  constructor(@Inject(VIDEOS_APPLICATION_PORT) private readonly videos: VideosApplicationPort) {}

  @Get(":channelId/videos")
  @Header("Cache-Control", "no-store")
  listRecent(
    @Param("channelId") channelId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.videos.listRecent({
      channelId: parseUuid(channelId),
      ...parseVideosQuery(query),
      subject: request.user,
    });
  }

  @Get(":channelId/videos/:videoId/snapshots")
  @Header("Cache-Control", "no-store")
  snapshots(
    @Param("channelId") channelId: string,
    @Param("videoId") videoId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.videos.snapshots({
      channelId: parseUuid(channelId),
      videoId: parseUuid(videoId),
      ...parseVideosQuery(query),
      subject: request.user,
    });
  }
}
