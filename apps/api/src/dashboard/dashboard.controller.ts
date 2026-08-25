import { Controller, Get, Header, Inject, Query } from "@nestjs/common";

import {
  DASHBOARD_APPLICATION_PORT,
  type DashboardApplicationPort,
} from "./dashboard-application.port.js";
import { parseDashboardTrendsQuery } from "./dashboard.schemas.js";

@Controller("dashboard")
export class DashboardController {
  constructor(
    @Inject(DASHBOARD_APPLICATION_PORT)
    private readonly dashboard: DashboardApplicationPort,
  ) {}

  @Get("trends")
  @Header("Cache-Control", "no-store")
  trends(@Query() query: unknown) {
    return this.dashboard.trends(parseDashboardTrendsQuery(query));
  }
}
