import { Controller, Get, Header, Inject, Query, Req } from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/request-user.js";
import {
  DASHBOARD_APPLICATION_PORT,
  type DashboardApplicationPort,
} from "./dashboard-application.port.js";
import {
  parseDailyVideoLeadersQuery,
  parseDashboardRevenueQuery,
  parseDashboardTrendsQuery,
} from "./dashboard.schemas.js";

@Controller("dashboard")
export class DashboardController {
  constructor(
    @Inject(DASHBOARD_APPLICATION_PORT)
    private readonly dashboard: DashboardApplicationPort,
  ) {}

  @Get("trends")
  @Header("Cache-Control", "no-store")
  trends(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.dashboard.trends({
      ...parseDashboardTrendsQuery(query),
      subject: request.user,
    });
  }

  @Get("revenue")
  @Header("Cache-Control", "no-store")
  revenue(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.dashboard.revenue({
      ...parseDashboardRevenueQuery(query),
      subject: request.user,
    });
  }

  @Get("daily-video-leaders")
  @Header("Cache-Control", "no-store")
  dailyVideoLeaders(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.dashboard.dailyVideoLeaders({
      ...parseDailyVideoLeadersQuery(query),
      subject: request.user,
    });
  }
}
