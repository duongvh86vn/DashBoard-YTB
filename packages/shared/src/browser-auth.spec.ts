import { describe, expect, it } from "vitest";

import {
  ApiErrorEnvelopeSchema,
  CSRF_HEADER_NAME,
  PublicUserSchema,
  UserResponseSchema,
  UsersPageSchema,
  type AuthErrorCode,
} from "./browser-auth.js";

const viewer = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "người.xem@ví-dụ.测试",
  role: "VIEWER",
  isEnabled: true,
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:00:00.000Z",
  disabledAt: null,
} as const;

describe("browser authentication contracts", () => {
  it("keeps the shared CSRF header and the complete allowlisted error-code union", () => {
    const codes = [
      "AUTH_UNAUTHENTICATED",
      "AUTH_INVALID_CREDENTIALS",
      "AUTH_FORBIDDEN",
      "AUTH_CSRF_INVALID",
      "AUTH_RATE_LIMITED",
      "VALIDATION_ERROR",
      "USER_NOT_FOUND",
      "USER_ALREADY_EXISTS",
    ] as const satisfies readonly AuthErrorCode[];

    expect(CSRF_HEADER_NAME).toBe("x-csrf-protection");
    expect(codes).toHaveLength(8);
  });

  it("accepts a bounded seed-compatible Unicode email without narrowing it to z.email", () => {
    expect(PublicUserSchema.parse(viewer)).toEqual(viewer);

    expect(
      PublicUserSchema.safeParse({ ...viewer, email: `${"a".repeat(314)}@x.test` }).success,
    ).toBe(false);
  });

  it("strictly validates user, VIEWER-page, and known error envelopes", () => {
    expect(UserResponseSchema.parse({ user: viewer })).toEqual({ user: viewer });
    expect(UsersPageSchema.parse({ items: [viewer], page: 1, pageSize: 20, total: 1 })).toEqual({
      items: [viewer],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    expect(
      UsersPageSchema.safeParse({
        items: [{ ...viewer, role: "ADMIN" }],
        page: 1,
        pageSize: 20,
        total: 1,
      }).success,
    ).toBe(false);
    expect(UserResponseSchema.safeParse({ user: viewer, passwordHash: "secret" }).success).toBe(
      false,
    );
    expect(
      ApiErrorEnvelopeSchema.safeParse({
        error: { code: "DATABASE_ERROR", message: "internal database detail" },
      }).success,
    ).toBe(false);
  });
});
