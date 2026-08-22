export const VIDEOS_APPLICATION_PORT = Symbol("VIDEOS_APPLICATION_PORT");

export interface PublicVideo {
  id: string;
  youtubeVideoId: string;
  channelId: string;
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

export interface PublicVideoSnapshot {
  id: string;
  videoId: string;
  channelId: string;
  capturedAt: string;
  snapshotBucket: string;
  views: string | null;
  likes: string | null;
  comments: string | null;
  source: string;
}

export interface VideosApplicationPort {
  listRecent(input: { channelId: string; page: number; pageSize: number }): Promise<{
    items: PublicVideo[];
    page: number;
    pageSize: number;
    total: number;
  }>;
  snapshots(input: {
    channelId: string;
    videoId: string;
    page: number;
    pageSize: number;
  }): Promise<{
    items: PublicVideoSnapshot[];
    page: number;
    pageSize: number;
    total: number;
  }>;
}
