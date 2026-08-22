import type { Prisma as PrismaTypes } from "./generated/prisma/client.js";
import type { VideoSnapshotRecord, ChannelSnapshotSourceValue } from "./channel-records.js";

type VideoSnapshotClient = Pick<PrismaTypes.TransactionClient, "videoSnapshot">;

export interface UpsertVideoSnapshotInput {
  videoId: string;
  channelId: string;
  capturedAt: Date;
  snapshotBucket: Date;
  views: bigint | null;
  likes: bigint | null;
  comments: bigint | null;
  source: ChannelSnapshotSourceValue;
}

export class VideoSnapshotRepository {
  constructor(private readonly client: VideoSnapshotClient) {}

  upsert(input: UpsertVideoSnapshotInput): Promise<VideoSnapshotRecord> {
    return this.client.videoSnapshot.upsert({
      where: {
        videoId_snapshotBucket: { videoId: input.videoId, snapshotBucket: input.snapshotBucket },
      },
      create: input,
      update: {
        capturedAt: input.capturedAt,
        views: input.views,
        likes: input.likes,
        comments: input.comments,
        source: input.source,
      },
    });
  }

  latest(videoId: string): Promise<VideoSnapshotRecord | null> {
    return this.client.videoSnapshot.findFirst({
      where: { videoId },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    });
  }

  list(videoId: string, take = 100, skip = 0): Promise<VideoSnapshotRecord[]> {
    return this.client.videoSnapshot.findMany({
      where: { videoId },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
      skip,
      take,
    });
  }

  count(videoId: string): Promise<number> {
    return this.client.videoSnapshot.count({ where: { videoId } });
  }
}
