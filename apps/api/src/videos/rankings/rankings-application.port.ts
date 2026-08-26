export const VIDEO_RANKINGS_APPLICATION_PORT = Symbol("VIDEO_RANKINGS_APPLICATION_PORT");

import type { ChannelAccessSubject } from "../../channel-groups/channel-groups-application.port.js";
import type { PublicVideoSnapshot } from "../videos-application.port.js";

export interface PublicRankedVideo {
  rank: number;
  id: string;
  youtubeVideoId: string;
  channelId: string;
  channelTitle: string;
  title: string | null;
  thumbnail: string | null;
  publishedAt: string | null;
  currentViews: string | null;
  currentLikes: string | null;
  currentComments: string | null;
  status: "READY" | "WARMING_UP";
  weeklyGain: string | null;
  baselineAt: string | null;
  vph1h: number | null;
  vph3h: number | null;
  vph6h: number | null;
  smoothedVph: number | null;
  breakout24h: number | null;
  breakout48h: number | null;
  breakout7d: number | null;
}

export interface VideoRankingPage {
  items: PublicRankedVideo[];
  page: number;
  pageSize: number;
  total: number;
  warmingUpCount: number;
}

export interface PublicVideoSnapshotPage {
  items: PublicVideoSnapshot[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PublicVideoDetail {
  id: string;
  youtubeVideoId: string;
  channelId: string;
  channelTitle: string;
  title: string | null;
  description: string | null;
  thumbnail: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  currentViews: string | null;
  currentLikes: string | null;
  currentComments: string | null;
  monitorTier: string;
  firstSeenAt: string;
  lastSeenAt: string;
  isAvailable: boolean;
  isPinned: boolean;
}

export interface VideoRankingsApplicationPort {
  get(input: { videoId: string; subject: ChannelAccessSubject }): Promise<PublicVideoDetail>;
  recent(input: {
    channelId?: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<VideoRankingPage>;
  weekly(input: {
    channelId?: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<VideoRankingPage>;
  hot(input: {
    channelId?: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<VideoRankingPage>;
  breakout(input: {
    channelId?: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<VideoRankingPage>;
  snapshots(input: {
    videoId: string;
    page: number;
    pageSize: number;
    subject: ChannelAccessSubject;
  }): Promise<PublicVideoSnapshotPage>;
}
