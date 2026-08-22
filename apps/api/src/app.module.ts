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
import {
  HealthRepository,
  HeartbeatRepository,
  IdentityUnitOfWork,
  UserRepository,
  type DatabaseClient,
} from "@yt-monitor/db";
import { createPinoOptions } from "@yt-monitor/shared";
import { LoggerModule } from "nestjs-pino";

import { AuthExceptionFilter } from "./auth/auth-exception.filter.js";
import { AuthApplicationExceptionFilter } from "./auth/auth-application-exception.filter.js";
import { AUTH_APPLICATION_PORT, type AuthApplicationPort } from "./auth/auth-application.port.js";
import { AuthController } from "./auth/auth.controller.js";
import { systemClock, systemEntropy, systemPasswords } from "./auth/auth-runtime.ports.js";
import { AuthService } from "./auth/auth.service.js";
import { API_ENV } from "./auth/api-environment.port.js";
import { AuthPolicyError } from "./auth/auth-policy.error.js";
import { CsrfGuard } from "./auth/csrf.guard.js";
import { LoginThrottleService } from "./auth/login-throttle.service.js";
import { RolesGuard } from "./auth/roles.guard.js";
import {
  SESSION_AUTHENTICATION_PORT,
  type SessionAuthenticationPort,
} from "./auth/session-authentication.port.js";
import { SessionGuard } from "./auth/session.guard.js";
import { SessionCookieService } from "./auth/session-cookie.service.js";
import { HealthController } from "./health/health.controller.js";
import {
  HealthService,
  type DatabaseHealthReader,
  type WorkerHeartbeatReader,
} from "./health/health.service.js";
import { UserApplicationError } from "./users/user-application.error.js";
import {
  USERS_APPLICATION_PORT,
  type UsersApplicationPort,
} from "./users/users-application.port.js";
import { UsersController } from "./users/users.controller.js";
import { UsersService } from "./users/users.service.js";

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
  authApplication?: AuthApplicationPort;
  usersApplication?: UsersApplicationPort;
}

const denyAllSessionAuthenticator: SessionAuthenticationPort = {
  async authenticate(): Promise<null> {
    return null;
  },
};

const denyAllAuthApplication: AuthApplicationPort = {
  async login(): Promise<never> {
    throw AuthPolicyError.unauthenticated();
  },
  async logout(): Promise<never> {
    throw AuthPolicyError.unauthenticated();
  },
  async changePassword(): Promise<never> {
    throw AuthPolicyError.unauthenticated();
  },
};

const denyAllUsersApplication: UsersApplicationPort = {
  async list(): Promise<never> {
    throw UserApplicationError.unauthenticated();
  },
  async create(): Promise<never> {
    throw UserApplicationError.unauthenticated();
  },
  async updateEmail(): Promise<never> {
    throw UserApplicationError.unauthenticated();
  },
  async resetPassword(): Promise<never> {
    throw UserApplicationError.unauthenticated();
  },
  async revokeSessions(): Promise<never> {
    throw UserApplicationError.unauthenticated();
  },
  async disable(): Promise<never> {
    throw UserApplicationError.unauthenticated();
  },
  async enable(): Promise<never> {
    throw UserApplicationError.unauthenticated();
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
  authApplication: AuthApplicationPort,
  usersApplication: UsersApplicationPort,
): Provider[] {
  return [
    { provide: API_ENV, useValue: env },
    { provide: DATABASE_HEALTH_READER, useValue: databaseHealthReader },
    { provide: WORKER_HEARTBEAT_READER, useValue: workerHeartbeatReader },
    { provide: SESSION_AUTHENTICATION_PORT, useValue: sessionAuthenticator },
    { provide: AUTH_APPLICATION_PORT, useValue: authApplication },
    { provide: USERS_APPLICATION_PORT, useValue: usersApplication },
    {
      provide: SessionCookieService,
      useValue: new SessionCookieService(env.DEPLOYMENT_MODE, env.SESSION_ABSOLUTE_HOURS),
    },
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
    { provide: APP_FILTER, useClass: AuthApplicationExceptionFilter },
  ];
}

@Module({})
export class AppModule {
  static forProduction(options: ProductionAppModuleOptions): DynamicModule {
    const healthRepository = new HealthRepository(options.databaseClient);
    const heartbeatRepository = new HeartbeatRepository(options.databaseClient);
    const throttle = new LoginThrottleService({
      sessionSecret: options.env.SESSION_SECRET,
      maxAttempts: options.env.LOGIN_MAX_ATTEMPTS,
      lockMinutes: options.env.LOGIN_LOCK_MINUTES,
    });
    const userRepository = new UserRepository(options.databaseClient);
    const identityUnitOfWork = new IdentityUnitOfWork(options.databaseClient);
    const authApplication = new AuthService({
      users: userRepository,
      unitOfWork: identityUnitOfWork,
      throttle,
      clock: systemClock,
      entropy: systemEntropy,
      passwords: systemPasswords,
      sessionSecret: options.env.SESSION_SECRET,
      sessionIdleMinutes: options.env.SESSION_IDLE_MINUTES,
      sessionAbsoluteHours: options.env.SESSION_ABSOLUTE_HOURS,
    });
    const usersApplication = new UsersService({
      unitOfWork: identityUnitOfWork,
      clock: systemClock,
      passwords: systemPasswords,
    });

    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: createPinoOptions("api", options.env.LOG_LEVEL),
        }),
      ],
      controllers: [AuthController, HealthController, UsersController],
      providers: [
        ...applicationProviders(
          options.env,
          healthRepository,
          heartbeatRepository,
          options.sessionAuthenticator ?? denyAllSessionAuthenticator,
          authApplication,
          usersApplication,
        ),
        { provide: DATABASE_CLIENT, useValue: options.databaseClient },
        DatabaseLifecycle,
      ],
    };
  }

  static forTesting(options: TestingAppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [AuthController, HealthController, UsersController],
      providers: applicationProviders(
        options.env,
        options.databaseHealthReader,
        options.workerHeartbeatReader,
        options.sessionAuthenticator ?? denyAllSessionAuthenticator,
        options.authApplication ?? denyAllAuthApplication,
        options.usersApplication ?? denyAllUsersApplication,
      ),
    };
  }
}
