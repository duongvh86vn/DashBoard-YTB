import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { createPinoOptions } from "@yt-monitor/shared";
import pino, { type Logger } from "pino";

import { AppModule, DATABASE_CLIENT, WORKER_ENV, WORKER_LOGGER } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const env = app.get(WORKER_ENV);
  const databaseClient = app.get(DATABASE_CLIENT);
  const logger = app.get<Logger>(WORKER_LOGGER);

  logger.info({ version: env.APP_VERSION }, "Worker started");

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (signal: string): Promise<void> => {
    shutdownPromise ??= (async () => {
      logger.info({ signal }, "Worker stopping");
      await app.close();
      await databaseClient.$disconnect();
    })();

    return shutdownPromise;
  };

  const handleSignal = (signal: string): void => {
    void shutdown(signal).catch(() => {
      logger.fatal({ code: "WORKER_SHUTDOWN_FAILED", signal }, "Worker failed to stop cleanly");
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
}

void bootstrap().catch(() => {
  const logger = pino(createPinoOptions("worker"));
  logger.fatal({ code: "WORKER_BOOT_FAILED" }, "Worker failed to start");
  process.exitCode = 1;
});
