import { Controller, Get, Header, Inject, Param, Query, Req } from "@nestjs/common";

import type { AuthenticatedRequest } from "../../auth/request-user.js";
import {
  VIDEO_RANKINGS_APPLICATION_PORT,
  type VideoRankingsApplicationPort,
} from "./rankings-application.port.js";
import { parseRankingQuery, parseSnapshotHistoryQuery, parseVideoId } from "./rankings.schemas.js";

@Controller("videos")
export class VideoRankingsController {
  constructor(
    @Inject(VIDEO_RANKINGS_APPLICATION_PORT)
    private readonly rankings: VideoRankingsApplicationPort,
  ) {}

  @Get("recent")
  @Header("Cache-Control", "no-store")
  recentAlias(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.rankings.recent({ ...parseRankingQuery(query), subject: request.user });
  }

  @Get("rankings/weekly")
  @Header("Cache-Control", "no-store")
  weekly(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.rankings.weekly({ ...parseRankingQuery(query), subject: request.user });
  }

  @Get("rankings/hot")
  @Header("Cache-Control", "no-store")
  hot(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.rankings.hot({ ...parseRankingQuery(query), subject: request.user });
  }

  @Get("rankings/breakout")
  @Header("Cache-Control", "no-store")
  breakout(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.rankings.breakout({ ...parseRankingQuery(query), subject: request.user });
  }

  @Get(":id/snapshots")
  @Header("Cache-Control", "no-store")
  snapshots(
    @Param("id") id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rankings.snapshots({
      videoId: parseVideoId(id),
      ...parseSnapshotHistoryQuery(query),
      subject: request.user,
    });
  }

  @Get(":id")
  @Header("Cache-Control", "no-store")
  get(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.rankings.get({ videoId: parseVideoId(id), subject: request.user });
  }

  @Get()
  @Header("Cache-Control", "no-store")
  recent(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.rankings.recent({ ...parseRankingQuery(query), subject: request.user });
  }
}
