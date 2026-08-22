import { hostname } from "node:os";

import { Injectable, Module, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { parseWorkerEnv } from "@yt-monitor/config";
import {
  createPrismaClient,
  ChannelRepository,
  ChannelUnitOfWork,
  HeartbeatRepository,
  VideoRepository,
  VideoSnapshotRepository,
} from "@yt-monitor/db";
import { createPinoOptions } from "@yt-monitor/shared";
import pino from "pino";

import { HeartbeatService } from "./heartbeat/heartbeat.service.js";
import { ChannelHealthJob } from "./jobs/channel-health.job.js";
import { createChannelHealthProviders } from "./jobs/channel-health-provider.js";
import { ChannelHealthScheduler, HealthCircuitWindow } from "./jobs/channel-health.scheduler.js";
import { VideoDiscoveryJob } from "./video-monitor/discovery.js";
import { VideoReconcileJob } from "./video-monitor/reconcile.js";
import { VideoSnapshotJob } from "./video-monitor/snapshot.js";
import { VideoMonitorScheduler } from "./video-monitor/scheduler.js";
import {
  createVideoDiscoveryRepository,
  createVideoRuntimeProviders,
} from "./video-monitor/runtime-providers.js";

const workerEnv = parseWorkerEnv(process.env);
const databaseClient = createPrismaClient(workerEnv.DATABASE_URL);
const heartbeatRepository = new HeartbeatRepository(databaseClient);
const workerLogger = pino(createPinoOptions("worker", workerEnv.LOG_LEVEL));
const channelUnitOfWork = new ChannelUnitOfWork(databaseClient);
const channelRepository = new ChannelRepository(databaseClient);
const healthProviders = createChannelHealthProviders({
  env: { PLAYWRIGHT_EXECUTABLE_PATH: workerEnv.PLAYWRIGHT_EXECUTABLE_PATH },
});
const healthCircuitWindow = new HealthCircuitWindow();
const channelHealthJob = new ChannelHealthJob({
  unitOfWork: channelUnitOfWork,
  ...healthProviders,
  circuitOpen: () => healthCircuitWindow.state().open,
});
const channelHealthScheduler = new ChannelHealthScheduler({
  channels: channelRepository,
  job: channelHealthJob,
  logger: workerLogger,
  intervalMs: workerEnv.CHANNEL_HEALTH_HOURS * 60 * 60 * 1000,
  circuitWindow: healthCircuitWindow,
});
const videoRepository = new VideoRepository(databaseClient);
const videoSnapshotRepository = new VideoSnapshotRepository(databaseClient);
const videoRuntimeProviders = createVideoRuntimeProviders();
const videoDiscoveryRepository = createVideoDiscoveryRepository(videoRepository);
const videoDiscoveryJob = new VideoDiscoveryJob({
  repository: videoDiscoveryRepository,
  rssDiscover: videoRuntimeProviders.rssDiscover,
  ytdlpList: videoRuntimeProviders.ytdlpList,
});
const videoReconcileJob = new VideoReconcileJob({
  repository: videoDiscoveryRepository,
  listVideos: videoRuntimeProviders.ytdlpList,
});
const videoSnapshotJob = new VideoSnapshotJob({
  unitOfWork: channelUnitOfWork,
  statsProvider: { getVideoStats: videoRuntimeProviders.getVideoStats },
});
const videoMonitorScheduler = new VideoMonitorScheduler({
  channels: channelRepository,
  videos: videoRepository,
  discovery: videoDiscoveryJob,
  reconcile: videoReconcileJob,
  snapshots: videoSnapshotRepository,
  snapshot: videoSnapshotJob,
  logger: workerLogger,
  rssIntervalMs: workerEnv.RSS_SCAN_MINUTES * 60 * 1000,
  reconcileIntervalMs: workerEnv.CHANNEL_SCAN_HOURS * 60 * 60 * 1000,
  snapshotIntervalMs: 60 * 60 * 1000,
  jitterMs: 15_000,
});

export const WORKER_ENV = Symbol("WORKER_ENV");
export const DATABASE_CLIENT = Symbol("DATABASE_CLIENT");
export const WORKER_LOGGER = Symbol("WORKER_LOGGER");

@Injectable()
class ChannelHealthSchedulerLifecycle implements OnModuleInit, OnModuleDestroy {
  onModuleInit(): void {
    channelHealthScheduler.start();
  }

  onModuleDestroy(): void {
    channelHealthScheduler.stop();
  }
}

@Injectable()
class VideoMonitorSchedulerLifecycle implements OnModuleInit, OnModuleDestroy {
  onModuleInit(): void {
    videoMonitorScheduler.start();
  }

  onModuleDestroy(): void {
    videoMonitorScheduler.stop();
  }
}

@Module({
  providers: [
    { provide: WORKER_ENV, useValue: workerEnv },
    { provide: DATABASE_CLIENT, useValue: databaseClient },
    { provide: WORKER_LOGGER, useValue: workerLogger },
    { provide: ChannelUnitOfWork, useValue: channelUnitOfWork },
    { provide: ChannelRepository, useValue: channelRepository },
    { provide: ChannelHealthJob, useValue: channelHealthJob },
    { provide: ChannelHealthScheduler, useValue: channelHealthScheduler },
    ChannelHealthSchedulerLifecycle,
    { provide: VideoRepository, useValue: videoRepository },
    { provide: VideoSnapshotRepository, useValue: videoSnapshotRepository },
    { provide: VideoDiscoveryJob, useValue: videoDiscoveryJob },
    { provide: VideoReconcileJob, useValue: videoReconcileJob },
    { provide: VideoSnapshotJob, useValue: videoSnapshotJob },
    { provide: VideoMonitorScheduler, useValue: videoMonitorScheduler },
    VideoMonitorSchedulerLifecycle,
    { provide: HeartbeatRepository, useValue: heartbeatRepository },
    {
      provide: HeartbeatService,
      inject: [HeartbeatRepository],
      useFactory: (repository: HeartbeatRepository) =>
        new HeartbeatService(
          repository,
          workerEnv.WORKER_ID ?? hostname(),
          workerEnv.APP_VERSION,
          workerEnv.WORKER_HEARTBEAT_INTERVAL_SECONDS * 1000,
          (error) => {
            workerLogger.error(
              {
                code: "WORKER_HEARTBEAT_WRITE_FAILED",
                errorName: error instanceof Error ? error.name : "UnknownError",
              },
              "Worker heartbeat write failed",
            );
          },
        ),
    },
  ],
})
export class AppModule {}
