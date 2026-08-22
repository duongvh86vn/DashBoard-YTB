import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { parseApiEnv } from "@yt-monitor/config";
import { createPrismaClient, SessionRepository, type DatabaseClient } from "@yt-monitor/db";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module.js";
import { systemClock } from "./auth/auth-runtime.ports.js";
import { SessionAuthenticator } from "./auth/session-authenticator.js";

async function bootstrap(): Promise<void> {
  const env = parseApiEnv(process.env);
  let databaseClient: DatabaseClient | undefined;
  let app: INestApplication | undefined;

  try {
    databaseClient = createPrismaClient(env.DATABASE_URL);
    const sessionAuthenticator = new SessionAuthenticator({
      sessions: new SessionRepository(databaseClient),
      sessionSecret: env.SESSION_SECRET,
      idleMinutes: env.SESSION_IDLE_MINUTES,
      clock: systemClock,
    });
    app = await NestFactory.create(
      AppModule.forProduction({ env, databaseClient, sessionAuthenticator }),
      {
        abortOnError: false,
        bufferLogs: true,
      },
    );

    app.useLogger(app.get(Logger));
    app.enableShutdownHooks();
    app.setGlobalPrefix("api/v1");
    await app.listen(env.API_PORT, "0.0.0.0");
  } catch (error) {
    try {
      if (app) {
        await app.close();
      } else if (databaseClient) {
        await databaseClient.$disconnect();
      }
    } catch {
      // Preserve the original bootstrap error while still attempting cleanup.
    }

    throw error;
  }
}

void bootstrap().catch(() => {
  process.exitCode = 1;
});
