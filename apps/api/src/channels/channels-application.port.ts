import type { PublicChannelProvider } from "@yt-monitor/shared";

export const CHANNELS_APPLICATION_PORT = Symbol("CHANNELS_APPLICATION_PORT");
export const CHANNEL_PROVIDER = Symbol("CHANNEL_PROVIDER");

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
  list(input: { page: number; pageSize: number }): Promise<{
    items: PublicChannel[];
    page: number;
    pageSize: number;
    total: number;
  }>;
  get(id: string): Promise<PublicChannel>;
  create(input: { originalInput: string }): Promise<PublicChannel>;
  archive(input: { id: string }): Promise<void>;
}

export type ChannelProviderPort = PublicChannelProvider;
