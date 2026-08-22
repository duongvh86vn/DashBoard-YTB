import { Controller, Get, Header, Inject, Param, Query } from "@nestjs/common";

import { VIDEOS_APPLICATION_PORT, type VideosApplicationPort } from "./videos-application.port.js";
import { parseUuid, parseVideosQuery } from "./videos.schemas.js";

@Controller("channels")
export class VideosController {
  constructor(@Inject(VIDEOS_APPLICATION_PORT) private readonly videos: VideosApplicationPort) {}

  @Get(":channelId/videos")
  @Header("Cache-Control", "no-store")
  listRecent(@Param("channelId") channelId: string, @Query() query: unknown) {
    return this.videos.listRecent({ channelId: parseUuid(channelId), ...parseVideosQuery(query) });
  }

  @Get(":channelId/videos/:videoId/snapshots")
  @Header("Cache-Control", "no-store")
  snapshots(
    @Param("channelId") channelId: string,
    @Param("videoId") videoId: string,
    @Query() query: unknown,
  ) {
    return this.videos.snapshots({
      channelId: parseUuid(channelId),
      videoId: parseUuid(videoId),
      ...parseVideosQuery(query),
    });
  }
}
