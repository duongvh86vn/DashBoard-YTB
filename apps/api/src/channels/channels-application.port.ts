import type { PublicChannelProvider, PublicIntelligenceResponse } from "@yt-monitor/shared";
import type { ChannelAccessSubject } from "../channel-groups/channel-groups-application.port.js";

export const CHANNELS_APPLICATION_PORT = Symbol("CHANNELS_APPLICATION_PORT");
export const CHANNEL_PROVIDER = Symbol("CHANNEL_PROVIDER");

export interface PublicSyncRun {
  id: string;
  channelId: string | null;
  jobType: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  recordsProcessed: number | null;
  errorCode: string | null;
  errorMessageSafe: string | null;
  createdAt: string;
}

export interface SyncRunsPage {
  items: PublicSyncRun[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PublicChannel {
  id: string;
  youtubeChannelId: string;
  originalInput: string;
  canonicalUrl: string;
  handle: string | null;
  title: string;
  description: string | null;
  thumbnail: string | null;
  subscriberCount: string | null;
  videoCount: string | null;
  lifetimeViewCount: string | null;
  lastUploadAt: string | null;
  availabilityStatus: string;
  activityStatus: string;
  lastChannelScanAt: string | null;
  lastHealthCheckAt: string | null;
  lastSeenAliveAt: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ChannelsApplicationPort {
  list(input: { page: number; pageSize: number; subject: ChannelAccessSubject }): Promise<{
    items: PublicChannel[];
    page: number;
    pageSize: number;
    total: number;
  }>;
  get(input: { id: string; subject: ChannelAccessSubject }): Promise<PublicChannel>;
  publicIntelligence(input: {
    id: string;
    days: number;
    subject: ChannelAccessSubject;
  }): Promise<PublicIntelligenceResponse>;
  create(input: { originalInput: string }): Promise<PublicChannel>;
  archive(input: { id: string }): Promise<void>;
  requestHealthCheck(input: { id: string }): Promise<{ syncRunId: string; status: "QUEUED" }>;
  healthHistory(input: {
    id: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<{
    items: PublicChannelHealthCheck[];
    page: number;
    pageSize: number;
    total: number;
  }>;
  syncRuns(input: { page: number; pageSize: number }): Promise<SyncRunsPage>;
}

export interface PublicChannelHealthCheck {
  id: string;
  channelId: string;
  checkedAt: string;
  publicPageStatus: string;
  ytdlpStatus: string;
  rssStatus: string;
  normalizedAvailability: string;
  evidenceCode: string;
  evidenceTextSafe: string | null;
  httpStatus: number | null;
  durationMs: number;
  createdAt: string;
}

export type ChannelProviderPort = PublicChannelProvider;
