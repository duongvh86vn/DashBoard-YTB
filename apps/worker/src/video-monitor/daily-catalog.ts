import type { YtdlpFullCatalog } from "@yt-monitor/collector-ytdlp";
import type { ChannelRecord, ChannelUnitOfWork } from "@yt-monitor/db";
import { localCalendarDate, localCalendarDateStart } from "@yt-monitor/shared";

export const DAILY_CATALOG_BUCKET_OFFSET_MS = 20 * 60 * 1_000;

export interface DailyVideoCatalogJobDependencies {
  unitOfWork: Pick<ChannelUnitOfWork, "transaction">;
  collect(channel: ChannelRecord): Promise<YtdlpFullCatalog>;
  timeZone: string;
  now?: () => Date;
}

export interface DailyVideoCatalogResult {
  status: "COMPLETE" | "PARTIAL";
  totalVideos: number;
  videosWithViews: number;
  snapshotBucket: Date;
}

export class DailyVideoCatalogJob {
  constructor(private readonly dependencies: DailyVideoCatalogJobDependencies) {}

  async run(channel: ChannelRecord): Promise<DailyVideoCatalogResult> {
    const clock = this.dependencies.now ?? (() => new Date());
    const startedAt = clock();
    const startedCalendarDate = localCalendarDate(startedAt, this.dependencies.timeZone);
    const syncRun = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.syncRuns.create({
        channelId: channel.id,
        jobType: "VIDEO_CATALOG_DAILY",
        status: "RUNNING",
        startedAt,
      }),
    );

    let catalog: YtdlpFullCatalog;
    try {
      catalog = await this.dependencies.collect(channel);
    } catch {
      await this.failRun(
        syncRun.id,
        clock(),
        "VIDEO_CATALOG_COLLECTION_FAILED",
        "Daily public video catalog collection failed",
      );
      throw new Error("Daily catalog collection failed");
    }

    const capturedAt = clock();
    const calendarDate = localCalendarDate(capturedAt, this.dependencies.timeZone);
    if (calendarDate !== startedCalendarDate) {
      await this.failRun(
        syncRun.id,
        capturedAt,
        "VIDEO_CATALOG_LOCAL_DATE_CROSSED",
        "Daily public video catalog collection crossed the local date boundary",
      );
      throw new Error("Daily catalog collection crossed the local date boundary");
    }
    const date = new Date(`${calendarDate}T00:00:00.000Z`);
    // Keep the canonical daily catalog bucket deterministic without colliding
    // with the UTC-hour buckets used by the regular video monitor. Otherwise a
    // later hourly upsert can replace the YTDLP_CATALOG source evidence.
    const snapshotBucket = new Date(
      localCalendarDateStart(calendarDate, this.dependencies.timeZone).getTime() +
        DAILY_CATALOG_BUCKET_OFFSET_MS,
    );

    const videos = catalog.videos.filter((video) => video.channelId === channel.youtubeChannelId);
    const videosWithViews = videos.filter((video) => video.viewCount !== null).length;
    const complete =
      catalog.skippedEntryCount === 0 &&
      catalog.missingViewCount === 0 &&
      videos.length === catalog.sourceEntryCount;
    const status = complete ? ("COMPLETE" as const) : ("PARTIAL" as const);

    try {
      return await this.dependencies.unitOfWork.transaction(async (repositories) => {
        // Claim the channel/day inside the same transaction as every snapshot
        // write. PostgreSQL's unique key plus createMany(skipDuplicates) makes
        // the first committed writer immutable: a concurrent worker waits, then
        // observes the winner without touching its canonical snapshots.
        const claim = await repositories.videoCatalogScans.createIfAbsent({
          channelId: channel.id,
          date,
          capturedAt,
          snapshotBucket,
          totalVideos: catalog.sourceEntryCount,
          videosWithViews,
          coverageStatus: status,
        });
        if (!claim.created) {
          const canonicalStatus =
            claim.record.coverageStatus === "COMPLETE"
              ? ("COMPLETE" as const)
              : ("PARTIAL" as const);
          await repositories.syncRuns.complete(syncRun.id, {
            status: canonicalStatus === "COMPLETE" ? "SUCCESS" : "PARTIAL",
            completedAt: capturedAt,
            recordsProcessed: 0,
            errorCode: canonicalStatus === "COMPLETE" ? null : "VIDEO_CATALOG_PARTIAL",
            errorMessageSafe:
              canonicalStatus === "COMPLETE"
                ? null
                : "The existing daily public video catalog is partial",
          });
          return {
            status: canonicalStatus,
            totalVideos: claim.record.totalVideos,
            videosWithViews: claim.record.videosWithViews,
            snapshotBucket: claim.record.snapshotBucket,
          };
        }

        for (const video of videos) {
          const stored = await repositories.videos.upsertDiscovered({
            youtubeVideoId: video.videoId,
            channelId: channel.id,
            title: video.title,
            description: video.description,
            thumbnail: video.thumbnail,
            publishedAt: video.publishedAt,
            durationSeconds: video.durationSeconds,
            seenAt: capturedAt,
          });
          await repositories.videoSnapshots.upsert({
            videoId: stored.id,
            channelId: channel.id,
            capturedAt,
            snapshotBucket,
            views: video.viewCount,
            likes: video.likeCount,
            comments: video.commentCount,
            source: "YTDLP_CATALOG",
          });
        }
        await repositories.syncRuns.complete(syncRun.id, {
          status: complete ? "SUCCESS" : "PARTIAL",
          completedAt: capturedAt,
          recordsProcessed: videos.length,
          errorCode: complete ? null : "VIDEO_CATALOG_PARTIAL",
          errorMessageSafe: complete ? null : "Some public video counters were unavailable",
        });
        return {
          status,
          totalVideos: catalog.sourceEntryCount,
          videosWithViews,
          snapshotBucket,
        };
      });
    } catch {
      await this.failRun(
        syncRun.id,
        capturedAt,
        "VIDEO_CATALOG_PERSIST_FAILED",
        "Daily public video catalog persistence failed",
      );
      throw new Error("Daily catalog persistence failed");
    }
  }

  private async failRun(
    id: string,
    completedAt: Date,
    errorCode: string,
    errorMessageSafe: string,
  ): Promise<void> {
    try {
      await this.dependencies.unitOfWork.transaction((repositories) =>
        repositories.syncRuns.complete(id, {
          status: "FAILED",
          completedAt,
          recordsProcessed: 0,
          errorCode,
          errorMessageSafe,
        }),
      );
    } catch {
      // The original safe failure is still surfaced; the next scheduler poll retries.
    }
  }
}
