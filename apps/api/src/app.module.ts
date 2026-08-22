import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type Provider,
} from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import type { ApiEnv } from "@yt-monitor/config";
import { HealthRepository, HeartbeatRepository, type DatabaseClient } from "@yt-monitor/db";
import { createPinoOptions } from "@yt-monitor/shared";
import { LoggerModule } from "nestjs-pino";

import { AuthExceptionFilter } from "./auth/auth-exception.filter.js";
import { API_ENV } from "./auth/api-environment.port.js";
import { CsrfGuard } from "./auth/csrf.guard.js";
import { RolesGuard } from "./auth/roles.guard.js";
import {
  SESSION_AUTHENTICATION_PORT,
  type SessionAuthenticationPort,
} from "./auth/session-authentication.port.js";
import { SessionGuard } from "./auth/session.guard.js";
import { HealthController } from "./health/health.controller.js";
import {
  HealthService,
  type DatabaseHealthReader,
  type WorkerHeartbeatReader,
} from "./health/health.service.js";

export { API_ENV } from "./auth/api-environment.port.js";
export const DATABASE_CLIENT = Symbol("DATABASE_CLIENT");
const DATABASE_HEALTH_READER = Symbol("DATABASE_HEALTH_READER");
const WORKER_HEARTBEAT_READER = Symbol("WORKER_HEARTBEAT_READER");

export interface ProductionAppModuleOptions {
  env: ApiEnv;
  databaseClient: DatabaseClient;
  sessionAuthenticator?: SessionAuthenticationPort;
}

export interface TestingAppModuleOptions {
  env: ApiEnv;
  databaseHealthReader: DatabaseHealthReader;
  workerHeartbeatReader: WorkerHeartbeatReader;
  sessionAuthenticator?: SessionAuthenticationPort;
}

const denyAllSessionAuthenticator: SessionAuthenticationPort = {
  async authenticate(): Promise<null> {
    return null;
  },
};

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CLIENT) private readonly client: DatabaseClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}

function applicationProviders(
  env: ApiEnv,
  databaseHealthReader: DatabaseHealthReader,
  workerHeartbeatReader: WorkerHeartbeatReader,
  sessionAuthenticator: SessionAuthenticationPort,
): Provider[] {
  return [
    { provide: API_ENV, useValue: env },
    { provide: DATABASE_HEALTH_READER, useValue: databaseHealthReader },
    { provide: WORKER_HEARTBEAT_READER, useValue: workerHeartbeatReader },
    { provide: SESSION_AUTHENTICATION_PORT, useValue: sessionAuthenticator },
    {
      provide: HealthService,
      inject: [DATABASE_HEALTH_READER, WORKER_HEARTBEAT_READER],
      useFactory: (database: DatabaseHealthReader, worker: WorkerHeartbeatReader) =>
        new HealthService(database, worker, env.APP_VERSION, env.WORKER_HEARTBEAT_STALE_SECONDS),
    },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_FILTER, useClass: AuthExceptionFilter },
  ];
}

@Module({})
export class AppModule {
  static forProduction(options: ProductionAppModuleOptions): DynamicModule {
    const healthRepository = new HealthRepository(options.databaseClient);
    const heartbeatRepository = new HeartbeatRepository(options.databaseClient);

    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: createPinoOptions("api", options.env.LOG_LEVEL),
        }),
      ],
      controllers: [HealthController],
      providers: [
        ...applicationProviders(
          options.env,
          healthRepository,
          heartbeatRepository,
          options.sessionAuthenticator ?? denyAllSessionAuthenticator,
        ),
        { provide: DATABASE_CLIENT, useValue: options.databaseClient },
        DatabaseLifecycle,
      ],
    };
  }

  static forTesting(options: TestingAppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: applicationProviders(
        options.env,
        options.databaseHealthReader,
        options.workerHeartbeatReader,
        options.sessionAuthenticator ?? denyAllSessionAuthenticator,
      ),
    };
  }
}
