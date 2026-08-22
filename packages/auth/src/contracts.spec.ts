import { describe, expect, it } from "vitest";

import {
  CSRF_HEADER_NAME,
  SESSION_COOKIE_LOCAL,
  SESSION_COOKIE_PUBLIC,
  type AuthErrorCode,
} from "./index.js";

describe("auth transport contracts", () => {
  it("uses distinct host-only cookie names for local and public deployments", () => {
    expect(SESSION_COOKIE_LOCAL).toBe("yhm_session");
    expect(SESSION_COOKIE_PUBLIC).toBe("__Host-yhm_session");
  });

  it("uses the required CSRF request-header name", () => {
    expect(CSRF_HEADER_NAME).toBe("x-csrf-protection");
  });

  it("exposes the browser-safe validation and user-management error codes", () => {
    const codes = [
      "VALIDATION_ERROR",
      "USER_NOT_FOUND",
      "USER_ALREADY_EXISTS",
    ] as const satisfies readonly AuthErrorCode[];

    expect(codes).toEqual(["VALIDATION_ERROR", "USER_NOT_FOUND", "USER_ALREADY_EXISTS"]);
  });
});
