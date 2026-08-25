import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { parseChangePasswordBody, parseLoginBody, parseLogoutBody } from "./auth.schemas.js";

describe("auth request schemas", () => {
  it("accepts only the exact structural login shape without semantic email/password checks", () => {
    expect(parseLoginBody({ email: "not-an-email", password: "" })).toEqual({
      email: "not-an-email",
      password: "",
    });

    for (const body of [null, [], "text", {}, { email: "a", password: "b", extra: true }]) {
      expect(() => parseLoginBody(body)).toThrow(BadRequestException);
    }
  });

  it("accepts an absent logout body or exact empty object and rejects every semantic value", () => {
    expect(parseLogoutBody(undefined)).toBeUndefined();
    expect(parseLogoutBody({})).toBeUndefined();

    for (const body of [null, [], "", 0, false, { reason: "logout" }]) {
      expect(() => parseLogoutBody(body)).toThrow(BadRequestException);
    }
  });

  it("does not apply creation policy to currentPassword but enforces it for newPassword", () => {
    expect(
      parseChangePasswordBody({
        currentPassword: "",
        newPassword: "🔐".repeat(6),
      }),
    ).toEqual({ currentPassword: "", newPassword: "🔐".repeat(6) });

    for (const body of [
      { currentPassword: "current", newPassword: "short" },
      { currentPassword: "current", newPassword: "x".repeat(129) },
      { currentPassword: 1, newPassword: "valid password" },
      { currentPassword: "current", newPassword: "valid password", extra: true },
    ]) {
      expect(() => parseChangePasswordBody(body)).toThrow(BadRequestException);
    }
  });
});
