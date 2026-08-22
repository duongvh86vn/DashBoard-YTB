import { Controller, Get, Header, Inject, Param, Query } from "@nestjs/common";

import {
  VIDEO_RANKINGS_APPLICATION_PORT,
  type VideoRankingsApplicationPort,
} from "./rankings-application.port.js";
import { parseRankingQuery, parseVideoId } from "./rankings.schemas.js";

@Controller("videos")
export class VideoRankingsController {
  constructor(
    @Inject(VIDEO_RANKINGS_APPLICATION_PORT)
    private readonly rankings: VideoRankingsApplicationPort,
  ) {}

  @Get("recent")
  @Header("Cache-Control", "no-store")
  recentAlias(@Query() query: unknown) {
    return this.rankings.recent(parseRankingQuery(query));
  }

  @Get("rankings/weekly")
  @Header("Cache-Control", "no-store")
  weekly(@Query() query: unknown) {
    return this.rankings.weekly(parseRankingQuery(query));
  }

  @Get("rankings/hot")
  @Header("Cache-Control", "no-store")
  hot(@Query() query: unknown) {
    return this.rankings.hot(parseRankingQuery(query));
  }

  @Get("rankings/breakout")
  @Header("Cache-Control", "no-store")
  breakout(@Query() query: unknown) {
    return this.rankings.breakout(parseRankingQuery(query));
  }

  @Get(":id/snapshots")
  @Header("Cache-Control", "no-store")
  snapshots(@Param("id") id: string, @Query() query: unknown) {
    return this.rankings.snapshots({ videoId: parseVideoId(id), ...parseRankingQuery(query) });
  }

  @Get(":id")
  @Header("Cache-Control", "no-store")
  get(@Param("id") id: string) {
    return this.rankings.get({ videoId: parseVideoId(id) });
  }

  @Get()
  @Header("Cache-Control", "no-store")
  recent(@Query() query: unknown) {
    return this.rankings.recent(parseRankingQuery(query));
  }
}
