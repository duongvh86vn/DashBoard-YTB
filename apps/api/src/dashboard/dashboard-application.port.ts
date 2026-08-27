import type {
  DailyVideoLeadersResponse,
  DashboardRevenueResponse,
  DashboardTrendResponse,
} from "@yt-monitor/shared";
import type {
  ChannelAccessSubject,
  ChannelSelection,
} from "../channel-groups/channel-groups-application.port.js";

export const DASHBOARD_APPLICATION_PORT = Symbol("DASHBOARD_APPLICATION_PORT");

export interface DashboardApplicationPort {
  trends(
    input: { days: number; subject: ChannelAccessSubject } & ChannelSelection,
  ): Promise<DashboardTrendResponse>;
  revenue(
    input: { days: number; subject: ChannelAccessSubject } & ChannelSelection,
  ): Promise<DashboardRevenueResponse>;
  dailyVideoLeaders(
    input: { subject: ChannelAccessSubject } & ChannelSelection,
  ): Promise<DailyVideoLeadersResponse>;
}
