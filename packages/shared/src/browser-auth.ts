import { z } from "zod";

export const UserRoleValueSchema = z.enum(["ADMIN", "VIEWER"]);
export type UserRoleValue = z.infer<typeof UserRoleValueSchema>;

const boundedEmailSchema = z.string().min(1).max(320);
const timestampSchema = z.iso.datetime();

export const PublicUserSchema = z
  .object({
    id: z.uuid(),
    email: boundedEmailSchema,
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
