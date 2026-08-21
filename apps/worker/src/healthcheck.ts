import { hostname } from "node:os";

import { parseWorkerEnv } from "@yt-monitor/config";
import { createPrismaClient, HeartbeatRepository } from "@yt-monitor/db";
import { createPinoOptions } from "@yt-monitor/shared";
import pino from "pino";

import { evaluateWorkerHealth } from "./worker-healthcheck.js";

async function main(): Promise<void> {
  const env = parseWorkerEnv(process.env);
  const logger = pino(createPinoOptions("worker-healthcheck", env.LOG_LEVEL));
  const client = createPrismaClient(env.DATABASE_URL);

  try {
    const healthy = await evaluateWorkerHealth(
      new HeartbeatRepository(client),
      env.WORKER_ID ?? hostname(),
      env.WORKER_HEARTBEAT_STALE_SECONDS,
    );

    if (!healthy) {
      logger.error({ code: "WORKER_HEARTBEAT_STALE" }, "Worker heartbeat is unavailable");
      process.exitCode = 1;
    }
  } catch {
    logger.error({ code: "WORKER_HEALTHCHECK_FAILED" }, "Worker healthcheck failed");
    process.exitCode = 1;
  } finally {
    await client.$disconnect();
  }
}

void main();
