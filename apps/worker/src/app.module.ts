import { hostname } from "node:os";

import { Module } from "@nestjs/common";
import { parseWorkerEnv } from "@yt-monitor/config";
import { createPrismaClient, HeartbeatRepository } from "@yt-monitor/db";
import { createPinoOptions } from "@yt-monitor/shared";
import pino from "pino";

import { HeartbeatService } from "./heartbeat/heartbeat.service.js";

const workerEnv = parseWorkerEnv(process.env);
const databaseClient = createPrismaClient(workerEnv.DATABASE_URL);
const heartbeatRepository = new HeartbeatRepository(databaseClient);
const workerLogger = pino(createPinoOptions("worker", workerEnv.LOG_LEVEL));

export const WORKER_ENV = Symbol("WORKER_ENV");
export const DATABASE_CLIENT = Symbol("DATABASE_CLIENT");
export const WORKER_LOGGER = Symbol("WORKER_LOGGER");

@Module({
  providers: [
    { provide: WORKER_ENV, useValue: workerEnv },
    { provide: DATABASE_CLIENT, useValue: databaseClient },
    { provide: WORKER_LOGGER, useValue: workerLogger },
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
