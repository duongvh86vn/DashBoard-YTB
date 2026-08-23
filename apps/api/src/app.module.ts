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
  AIProviderRouter,
  GeminiProvider,
  NvidiaProvider,
  NoopAIProvider,
  type AIModelRoleConfig,
  type AIProvider,
} from "@yt-monitor/ai";
import {
  HealthRepository,
  HeartbeatRepository,
  IdentityUnitOfWork,
  ChannelUnitOfWork,
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
import { ChannelApplicationError } from "./channels/channel-application.error.js";
import {
  CHANNELS_APPLICATION_PORT,
  CHANNEL_PROVIDER,
  type ChannelsApplicationPort,
  type ChannelProviderPort,
} from "./channels/channels-application.port.js";
import { ChannelsController } from "./channels/channels.controller.js";
import { ChannelsService } from "./channels/channels.service.js";
import { CompositePublicChannelProvider } from "./channels/public-channel-provider.js";
import {
  VIDEOS_APPLICATION_PORT,
  type VideosApplicationPort,
} from "./videos/videos-application.port.js";
import { VideosController } from "./videos/videos.controller.js";
import { VideosService } from "./videos/videos.service.js";
import {
  VIDEO_RANKINGS_APPLICATION_PORT,
  type VideoRankingsApplicationPort,
} from "./videos/rankings/rankings-application.port.js";
import { VideoRankingsController } from "./videos/rankings/rankings.controller.js";
import { VideoRankingsService } from "./videos/rankings/rankings.service.js";
import { AI_APPLICATION_PORT, type AiApplicationPort } from "./ai/ai-application.port.js";
import { AiController } from "./ai/ai.controller.js";
import { AiService } from "./ai/ai.service.js";
import type { AiHealthReader } from "./health/health.service.js";

export { API_ENV } from "./auth/api-environment.port.js";
export const DATABASE_CLIENT = Symbol("DATABASE_CLIENT");
const DATABASE_HEALTH_READER = Symbol("DATABASE_HEALTH_READER");
const WORKER_HEARTBEAT_READER = Symbol("WORKER_HEARTBEAT_READER");
const AI_HEALTH_READER = Symbol("AI_HEALTH_READER");

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
  channelsApplication?: ChannelsApplicationPort;
  videosApplication?: VideosApplicationPort;
  videoRankingsApplication?: VideoRankingsApplicationPort;
  aiApplication?: AiApplicationPort;
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

const denyAllChannelsApplication: ChannelsApplicationPort = {
  async list(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
  async get(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
  async create(): Promise<never> {
    throw ChannelApplicationError.resolveFailed();
  },
  async archive(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
  async requestHealthCheck(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
  async healthHistory(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
  async syncRuns(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
};

const denyAllVideosApplication: VideosApplicationPort = {
  async listRecent(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
  async snapshots(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
};

const denyAllVideoRankingsApplication: VideoRankingsApplicationPort = {
  async get(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
  async recent(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
  async weekly(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
  async hot(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
  async breakout(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
  async snapshots(): Promise<never> {
    throw ChannelApplicationError.notFound();
  },
};

const denyAllAiApplication: AiApplicationPort = {
  async status() {
    return { available: false, message: "AI analysis unavailable", providers: [] };
  },
  async updateSettings(): Promise<never> {
    throw AuthPolicyError.unauthenticated();
  },
  async classifyChannel(): Promise<never> {
    throw AuthPolicyError.unauthenticated();
  },
  async getReport(): Promise<never> {
    throw AuthPolicyError.unauthenticated();
  },
  async discoverModels(): Promise<never> {
    throw AuthPolicyError.unauthenticated();
  },
  async testProvider(): Promise<never> {
    throw AuthPolicyError.unauthenticated();
  },
};

class ConfiguredAiHealthReader implements AiHealthReader {
  constructor(
    private readonly configured: boolean,
    private readonly model: string | null,
  ) {}

  getAiHealthCheck() {
    return this.configured
      ? {
          status: "degraded" as const,
          required: false,
          code: "AI_CONFIGURED_HEALTH_UNVERIFIED",
          details: { model: this.model ?? "configured" },
        }
      : { status: "disabled" as const, required: false, code: "AI_DISABLED" };
  }
}

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
  channelsApplication: ChannelsApplicationPort,
  videosApplication: VideosApplicationPort,
  videoRankingsApplication: VideoRankingsApplicationPort,
  aiApplication: AiApplicationPort,
  aiHealthReader: AiHealthReader,
  channelProvider: ChannelProviderPort,
): Provider[] {
  return [
    { provide: API_ENV, useValue: env },
    { provide: DATABASE_HEALTH_READER, useValue: databaseHealthReader },
    { provide: WORKER_HEARTBEAT_READER, useValue: workerHeartbeatReader },
    { provide: SESSION_AUTHENTICATION_PORT, useValue: sessionAuthenticator },
    { provide: AUTH_APPLICATION_PORT, useValue: authApplication },
    { provide: USERS_APPLICATION_PORT, useValue: usersApplication },
    { provide: CHANNELS_APPLICATION_PORT, useValue: channelsApplication },
    { provide: VIDEOS_APPLICATION_PORT, useValue: videosApplication },
    { provide: VIDEO_RANKINGS_APPLICATION_PORT, useValue: videoRankingsApplication },
    { provide: AI_APPLICATION_PORT, useValue: aiApplication },
    { provide: AI_HEALTH_READER, useValue: aiHealthReader },
    { provide: CHANNEL_PROVIDER, useValue: channelProvider },
    {
      provide: SessionCookieService,
      useValue: new SessionCookieService(env.DEPLOYMENT_MODE, env.SESSION_ABSOLUTE_HOURS),
    },
    {
      provide: HealthService,
      inject: [DATABASE_HEALTH_READER, WORKER_HEARTBEAT_READER, AI_HEALTH_READER],
      useFactory: (
        database: DatabaseHealthReader,
        worker: WorkerHeartbeatReader,
        ai: AiHealthReader,
      ) =>
        new HealthService(
          database,
          worker,
          env.APP_VERSION,
          env.WORKER_HEARTBEAT_STALE_SECONDS,
          2_000,
          ai,
        ),
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
    const channelUnitOfWork = new ChannelUnitOfWork(options.databaseClient);
    const channelProvider = new CompositePublicChannelProvider();
    const channelsApplication = new ChannelsService({
      unitOfWork: channelUnitOfWork,
      provider: channelProvider,
    });
    const videosApplication = new VideosService({ unitOfWork: channelUnitOfWork });
    const videoRankingsApplication = new VideoRankingsService({ unitOfWork: channelUnitOfWork });
    const nvidiaModel = options.env.NVIDIA_ANALYSIS_MODEL ?? options.env.NVIDIA_FAST_MODEL;
    const geminiProvider: AIProvider =
      options.env.GEMINI_API_KEY && options.env.GEMINI_ANALYSIS_MODEL
        ? new GeminiProvider({
            apiKey: options.env.GEMINI_API_KEY,
            ...(options.env.GEMINI_BASE_URL ? { baseUrl: options.env.GEMINI_BASE_URL } : {}),
            model: options.env.GEMINI_ANALYSIS_MODEL,
          })
        : new NoopAIProvider();
    const nvidiaProvider = new NvidiaProvider({
      ...(options.env.NVIDIA_API_KEY ? { apiKey: options.env.NVIDIA_API_KEY } : {}),
      ...(options.env.NVIDIA_BASE_URL ? { baseUrl: options.env.NVIDIA_BASE_URL } : {}),
      ...(nvidiaModel ? { model: nvidiaModel } : {}),
    });
    const roles: Partial<Record<AIModelRoleConfig["role"], AIModelRoleConfig>> = {};
    if (options.env.GEMINI_FAST_MODEL) {
      roles.FAST = { role: "FAST", provider: "GEMINI", modelId: options.env.GEMINI_FAST_MODEL };
    }
    if (options.env.GEMINI_ANALYSIS_MODEL) {
      roles.ANALYSIS = {
        role: "ANALYSIS",
        provider: "GEMINI",
        modelId: options.env.GEMINI_ANALYSIS_MODEL,
      };
    }
    if (options.env.NVIDIA_LONG_CONTEXT_MODEL) {
      roles.LONG_CONTEXT = {
        role: "LONG_CONTEXT",
        provider: "NVIDIA",
        modelId: options.env.NVIDIA_LONG_CONTEXT_MODEL,
      };
    }
    const fallbackModel = nvidiaModel;
    if (fallbackModel) {
      roles.FALLBACK = { role: "FALLBACK", provider: "NVIDIA", modelId: fallbackModel };
    }
    const aiProvider: AIProvider = new AIProviderRouter(geminiProvider, nvidiaProvider, {
      providers: [nvidiaProvider],
      roles,
    });
    const aiApplication = new AiService({
      unitOfWork: channelUnitOfWork,
      provider: aiProvider,
      model: null,
      ...(options.env.SECRET_ENCRYPTION_KEY
        ? { encryptionKey: options.env.SECRET_ENCRYPTION_KEY }
        : {}),
    });

    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: createPinoOptions("api", options.env.LOG_LEVEL),
        }),
      ],
      controllers: [
        AuthController,
        HealthController,
        UsersController,
        ChannelsController,
        VideosController,
        VideoRankingsController,
        AiController,
      ],
      providers: [
        ...applicationProviders(
          options.env,
          healthRepository,
          heartbeatRepository,
          options.sessionAuthenticator ?? denyAllSessionAuthenticator,
          authApplication,
          usersApplication,
          channelsApplication,
          videosApplication,
          videoRankingsApplication,
          aiApplication,
          new ConfiguredAiHealthReader(
            Boolean(options.env.GEMINI_API_KEY || options.env.NVIDIA_API_KEY),
            options.env.GEMINI_ANALYSIS_MODEL ?? null,
          ),
          channelProvider,
        ),
        { provide: DATABASE_CLIENT, useValue: options.databaseClient },
        DatabaseLifecycle,
      ],
    };
  }

  static forTesting(options: TestingAppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        AuthController,
        HealthController,
        UsersController,
        ChannelsController,
        VideosController,
        VideoRankingsController,
        AiController,
      ],
      providers: applicationProviders(
        options.env,
        options.databaseHealthReader,
        options.workerHeartbeatReader,
        options.sessionAuthenticator ?? denyAllSessionAuthenticator,
        options.authApplication ?? denyAllAuthApplication,
        options.usersApplication ?? denyAllUsersApplication,
        options.channelsApplication ?? denyAllChannelsApplication,
        options.videosApplication ?? denyAllVideosApplication,
        options.videoRankingsApplication ?? denyAllVideoRankingsApplication,
        options.aiApplication ?? denyAllAiApplication,
        new ConfiguredAiHealthReader(false, null),
        new CompositePublicChannelProvider(),
      ),
    };
  }
}
