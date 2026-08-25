import { z } from "zod";

const MAX_CANONICAL_EMAIL_LENGTH = 320;
const CANONICAL_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const DATABASE_UNSAFE_EMAIL_PATTERN = /[\p{Cc}\p{Cs}]/u;

export function isValidCanonicalEmail(email: string): boolean {
  return (
    email.length > 0 &&
    email.length <= MAX_CANONICAL_EMAIL_LENGTH &&
    !DATABASE_UNSAFE_EMAIL_PATTERN.test(email) &&
    CANONICAL_EMAIL_PATTERN.test(email)
  );
}

export const UserRoleValueSchema = z.enum(["ADMIN", "VIEWER"]);
export type UserRoleValue = z.infer<typeof UserRoleValueSchema>;

const canonicalEmailSchema = z.string().refine(isValidCanonicalEmail);
const timestampSchema = z.iso.datetime();

export const PublicUserSchema = z
  .object({
    id: z.uuid(),
    email: canonicalEmailSchema,
    role: UserRoleValueSchema,
    isEnabled: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    disabledAt: timestampSchema.nullable(),
  })
  .strict();
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const AuthErrorCodeSchema = z.enum([
  "AUTH_UNAUTHENTICATED",
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_FORBIDDEN",
  "AUTH_CSRF_INVALID",
  "AUTH_RATE_LIMITED",
  "VALIDATION_ERROR",
  "USER_NOT_FOUND",
  "USER_ALREADY_EXISTS",
  "CHANNEL_INPUT_INVALID",
  "CHANNEL_NOT_FOUND",
  "CHANNEL_ALREADY_EXISTS",
  "CHANNEL_RESOLVE_FAILED",
]);
export type AuthErrorCode = z.infer<typeof AuthErrorCodeSchema>;

export const UserResponseSchema = z.object({ user: PublicUserSchema }).strict();

const viewerSchema = PublicUserSchema.extend({ role: z.literal("VIEWER") });

export const UsersPageSchema = z
  .object({
    items: z.array(viewerSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type UsersPage = z.infer<typeof UsersPageSchema>;

const publicChannelSchema = z
  .object({
    id: z.uuid(),
    youtubeChannelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/u),
    originalInput: z.string().min(1),
    canonicalUrl: z.url(),
    handle: z.string().nullable(),
    title: z.string().min(1),
    description: z.string().nullable(),
    thumbnail: z.string().nullable(),
    subscriberCount: z.string().regex(/^\d+$/u).nullable(),
    videoCount: z.string().regex(/^\d+$/u).nullable(),
    lifetimeViewCount: z.string().regex(/^\d+$/u).nullable(),
    lastUploadAt: timestampSchema.nullable(),
    availabilityStatus: z.string().min(1),
    activityStatus: z.string().min(1),
    lastChannelScanAt: timestampSchema.nullable(),
    lastHealthCheckAt: timestampSchema.nullable(),
    lastSeenAliveAt: timestampSchema.nullable(),
    isEnabled: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    archivedAt: timestampSchema.nullable(),
  })
  .strict();
export const PublicChannelSchema = publicChannelSchema;
export type PublicChannel = z.infer<typeof publicChannelSchema>;

export const ChannelResponseSchema = z.object({ channel: publicChannelSchema }).strict();
export const ChannelsPageSchema = z
  .object({
    items: z.array(publicChannelSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type ChannelsPage = z.infer<typeof ChannelsPageSchema>;

const publicVideoSchema = z
  .object({
    id: z.uuid(),
    youtubeVideoId: z.string().min(1),
    channelId: z.uuid(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    thumbnail: z.string().nullable(),
    publishedAt: timestampSchema.nullable(),
    durationSeconds: z.number().int().nonnegative().nullable(),
    currentViews: z.string().regex(/^\d+$/u).nullable(),
    currentLikes: z.string().regex(/^\d+$/u).nullable(),
    currentComments: z.string().regex(/^\d+$/u).nullable(),
    monitorTier: z.string().min(1),
    firstSeenAt: timestampSchema,
    lastSeenAt: timestampSchema,
    isAvailable: z.boolean(),
    isPinned: z.boolean(),
  })
  .strict();
export const PublicVideoSchema = publicVideoSchema;
export type PublicVideo = z.infer<typeof publicVideoSchema>;
export const VideosPageSchema = z
  .object({
    items: z.array(publicVideoSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
  })
  .strict();

const publicVideoSnapshotSchema = z
  .object({
    id: z.uuid(),
    videoId: z.uuid(),
    channelId: z.uuid(),
    capturedAt: timestampSchema,
    snapshotBucket: timestampSchema,
    views: z.string().regex(/^\d+$/u).nullable(),
    likes: z.string().regex(/^\d+$/u).nullable(),
    comments: z.string().regex(/^\d+$/u).nullable(),
    source: z.string().min(1),
  })
  .strict();
export const VideoSnapshotsPageSchema = z
  .object({
    items: z.array(publicVideoSnapshotSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type VideoSnapshotsPage = z.infer<typeof VideoSnapshotsPageSchema>;

const publicRankedVideoSchema = z
  .object({
    rank: z.number().int().positive(),
    id: z.uuid(),
    youtubeVideoId: z.string().min(1),
    channelId: z.uuid(),
    channelTitle: z.string().min(1),
    title: z.string().nullable(),
    thumbnail: z.string().nullable(),
    publishedAt: timestampSchema.nullable(),
    currentViews: z.string().regex(/^\d+$/u).nullable(),
    currentLikes: z.string().regex(/^\d+$/u).nullable(),
    currentComments: z.string().regex(/^\d+$/u).nullable(),
    status: z.enum(["READY", "WARMING_UP"]),
    weeklyGain: z
      .string()
      .regex(/^-?\d+$/u)
      .nullable(),
    baselineAt: timestampSchema.nullable(),
    vph1h: z.number().nullable(),
    vph3h: z.number().nullable(),
    vph6h: z.number().nullable(),
    smoothedVph: z.number().nullable(),
    breakout24h: z.number().nullable(),
    breakout48h: z.number().nullable(),
    breakout7d: z.number().nullable(),
  })
  .strict();
export const PublicRankedVideoSchema = publicRankedVideoSchema;
export type PublicRankedVideo = z.infer<typeof publicRankedVideoSchema>;
export const VideoRankingPageSchema = z
  .object({
    items: z.array(publicRankedVideoSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    warmingUpCount: z.number().int().nonnegative(),
  })
  .strict();
export type VideoRankingPage = z.infer<typeof VideoRankingPageSchema>;

const channelHealthCheckSchema = z
  .object({
    id: z.uuid(),
    channelId: z.uuid(),
    checkedAt: timestampSchema,
    publicPageStatus: z.string().min(1),
    ytdlpStatus: z.string().min(1),
    rssStatus: z.string().min(1),
    normalizedAvailability: z.string().min(1),
    evidenceCode: z.string().min(1),
    evidenceTextSafe: z.string().max(256).nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    durationMs: z.number().int().nonnegative(),
    createdAt: timestampSchema,
  })
  .strict();
export const ChannelHealthCheckSchema = channelHealthCheckSchema;
export type ChannelHealthCheck = z.infer<typeof channelHealthCheckSchema>;

export const ChannelHealthHistorySchema = z
  .object({
    items: z.array(channelHealthCheckSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type ChannelHealthHistory = z.infer<typeof ChannelHealthHistorySchema>;

export const ChannelHealthCheckQueuedSchema = z
  .object({
    syncRunId: z.uuid(),
    status: z.literal("QUEUED"),
  })
  .strict();

export const SyncRunsPageSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.uuid(),
          channelId: z.uuid().nullable(),
          jobType: z.string().min(1),
          status: z.string().min(1),
          startedAt: timestampSchema.nullable(),
          completedAt: timestampSchema.nullable(),
          recordsProcessed: z.number().int().nonnegative().nullable(),
          errorCode: z.string().nullable(),
          errorMessageSafe: z.string().max(512).nullable(),
          createdAt: timestampSchema,
        })
        .strict(),
    ),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type SyncRunsPage = z.infer<typeof SyncRunsPageSchema>;

const aiProviderStatusSchema = z
  .object({
    provider: z.enum(["GEMINI", "NVIDIA"]),
    status: z.enum(["DISABLED", "HEALTHY", "DEGRADED", "UNAVAILABLE"]),
    configured: z.boolean(),
    enabled: z.boolean(),
    priority: z.number().int().nonnegative(),
    model: z.string().nullable(),
    apiKeyMasked: z.string().nullable(),
    code: z.string().nullable(),
  })
  .strict();
export const AiStatusResponseSchema = z
  .object({
    available: z.boolean(),
    message: z.string().nullable(),
    providers: z.array(aiProviderStatusSchema),
  })
  .strict();
export type AiStatusResponse = z.infer<typeof AiStatusResponseSchema>;

export const AiModelsResponseSchema = z
  .object({
    provider: z.enum(["GEMINI", "NVIDIA"]),
    models: z.array(
      z
        .object({
          id: z.string().min(1),
          label: z.string().min(1),
          description: z.string().min(1).optional(),
          ownedBy: z.string().min(1).optional(),
          recommended: z.boolean(),
          source: z.enum(["BUNDLED", "DISCOVERED"]),
        })
        .strict(),
    ),
  })
  .strict();
export type AiModelsResponse = z.infer<typeof AiModelsResponseSchema>;

export const AiProviderTestResponseSchema = z
  .object({
    provider: z.enum(["GEMINI", "NVIDIA"]),
    status: z.enum(["DISABLED", "HEALTHY", "DEGRADED", "UNAVAILABLE"]),
    model: z.string().optional(),
    latencyMs: z.number().nonnegative().optional(),
    code: z.string().optional(),
  })
  .strict();
export type AiProviderTestResponse = z.infer<typeof AiProviderTestResponseSchema>;

export const AiReportResponseSchema = z
  .object({
    kind: z.enum(["DAILY", "WEEKLY"]),
    reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    available: z.boolean(),
    report: z.unknown().nullable(),
  })
  .strict();
export type AiReportResponse = z.infer<typeof AiReportResponseSchema>;

export const ApiErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: AuthErrorCodeSchema,
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const CSRF_HEADER_NAME = "x-csrf-protection";
