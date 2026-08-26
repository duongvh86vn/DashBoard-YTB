import type { DashboardTrendResponse } from "@yt-monitor/shared";
import type { ChannelAccessSubject } from "../channel-groups/channel-groups-application.port.js";

export const DASHBOARD_APPLICATION_PORT = Symbol("DASHBOARD_APPLICATION_PORT");

export interface DashboardApplicationPort {
  trends(input: { days: number; subject: ChannelAccessSubject }): Promise<DashboardTrendResponse>;
}
