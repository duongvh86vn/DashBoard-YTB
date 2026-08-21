import { Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { parseApiEnv } from "@yt-monitor/config";
import {
  createPrismaClient,
  HealthRepository,
  HeartbeatRepository,
  type DatabaseClient,
} from "@yt-monitor/db";
import { createPinoOptions } from "@yt-monitor/shared";
import { LoggerModule } from "nestjs-pino";

import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";

const apiEnv = parseApiEnv(process.env);
const databaseClient = createPrismaClient(apiEnv.DATABASE_URL);
const healthRepository = new HealthRepository(databaseClient);
const heartbeatRepository = new HeartbeatRepository(databaseClient);

export const API_ENV = Symbol("API_ENV");
export const DATABASE_CLIENT = Symbol("DATABASE_CLIENT");

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CLIENT) private readonly client: DatabaseClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}

@Module({
  imports: [LoggerModule.forRoot({ pinoHttp: createPinoOptions("api", apiEnv.LOG_LEVEL) })],
  controllers: [HealthController],
  providers: [
    { provide: API_ENV, useValue: apiEnv },
    { provide: DATABASE_CLIENT, useValue: databaseClient },
    { provide: HealthRepository, useValue: healthRepository },
    { provide: HeartbeatRepository, useValue: heartbeatRepository },
    {
      provide: HealthService,
      inject: [HealthRepository, HeartbeatRepository],
      useFactory: (database: HealthRepository, worker: HeartbeatRepository) =>
        new HealthService(
          database,
          worker,
          apiEnv.APP_VERSION,
          apiEnv.WORKER_HEARTBEAT_STALE_SECONDS,
        ),
    },
    DatabaseLifecycle,
  ],
})
export class AppModule {}
