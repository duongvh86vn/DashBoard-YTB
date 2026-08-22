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
