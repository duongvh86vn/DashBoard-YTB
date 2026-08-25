import type { DashboardTrendResponse } from "@yt-monitor/shared";

export const DASHBOARD_APPLICATION_PORT = Symbol("DASHBOARD_APPLICATION_PORT");

export interface DashboardApplicationPort {
  trends(input: { days: number }): Promise<DashboardTrendResponse>;
}
