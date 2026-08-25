import { describe, expect, it } from "vitest";

import {
  parseCreateUserBody,
  parseEmptyActionBody,
  parseListUsersQuery,
  parseResetPasswordBody,
  parseUpdateEmailBody,
  parseUserId,
} from "./users.schemas.js";

function expectValidationFailure(operation: () => unknown): void {
  expect(operation).toThrowError(expect.objectContaining({ status: 400 }));
}

describe("users request schemas", () => {
  it("defaults list pagination and accepts only canonical safe ASCII decimals", () => {
    expect(parseListUsersQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(parseListUsersQuery({ page: "2", pageSize: "100" })).toEqual({
      page: 2,
      pageSize: 100,
    });

    for (const query of [
      { page: "0" },
      { page: "+1" },
      { page: " 1" },
      { page: "01" },
      { page: "1.0" },
      { page: "1e2" },
      { page: "9007199254740992" },
      { page: "9007199254740991", pageSize: "2" },
      { pageSize: "101" },
      { page: ["1", "2"] },
      { pageSize: ["20", "30"] },
      { page: "1", search: "viewer" },
    ]) {
      expectValidationFailure(() => parseListUsersQuery(query));
    }
  });

  it.each(["tên@example.com", "admin@例子.com", "a@b.c", "double..dot@example.com"])(
    "normalizes the seed-compatible canonical email %s without narrowing its semantics",
    (email) => {
      expect(
        parseCreateUserBody({ email: `  ${email.toUpperCase()}  `, password: "twelve chars!" }),
      ).toEqual({ email: email.toLowerCase(), password: "twelve chars!" });
    },
  );

  it("preserves password bytes while enforcing the 6-128 Unicode-code-point policy", () => {
    const password = "  untrimmed🙂🙂";
    expect(Array.from(password)).toHaveLength(13);
    expect(parseCreateUserBody({ email: "viewer@example.com", password })).toEqual({
      email: "viewer@example.com",
      password,
    });

    expectValidationFailure(() =>
      parseCreateUserBody({ email: "viewer@example.com", password: "🙂".repeat(5) }),
    );
    expectValidationFailure(() =>
      parseCreateUserBody({ email: "viewer@example.com", password: "🙂".repeat(129) }),
    );
  });

  it("rejects invalid email semantics, non-objects, arrays, unknown keys, and role input", () => {
    for (const body of [
      null,
      [],
      "text",
      {},
      { email: "not-an-email", password: "twelve chars!" },
      { email: "viewer@example.com", password: "twelve chars!", role: "ADMIN" },
      { email: "viewer@example.com", password: "twelve chars!", extra: true },
      { email: 1, password: "twelve chars!" },
      { email: "viewer@example.com", password: 1 },
    ]) {
      expectValidationFailure(() => parseCreateUserBody(body));
    }
  });

  it("accepts only a strict canonical-email update body", () => {
    expect(parseUpdateEmailBody({ email: "  NEW@Example.COM  " })).toEqual({
      email: "new@example.com",
    });

    for (const body of [
      {},
      [],
      null,
      { email: "not-an-email" },
      { email: "viewer@example.com", role: "VIEWER" },
    ]) {
      expectValidationFailure(() => parseUpdateEmailBody(body));
    }
  });

  it("accepts only a strict reset-password body and preserves the password", () => {
    const password = "  replacement🙂";
    expect(parseResetPasswordBody({ password })).toEqual({ password });

    for (const body of [
      {},
      [],
      null,
      { password: "short" },
      { password: "replacement password", role: "VIEWER" },
    ]) {
      expectValidationFailure(() => parseResetPasswordBody(body));
    }
  });

  it("accepts only canonical UUID path parameters", () => {
    expect(parseUserId("00000000-0000-4000-8000-000000000001")).toBe(
      "00000000-0000-4000-8000-000000000001",
    );

    for (const id of [
      "",
      "viewer-id",
      "{00000000-0000-4000-8000-000000000001}",
      "00000000000040008000000000000001",
      "00000000-0000-0000-0000-000000000000",
    ]) {
      expectValidationFailure(() => parseUserId(id));
    }
  });

  it("accepts absent or exact empty action bodies and rejects every other shape", () => {
    expect(parseEmptyActionBody(undefined)).toBeUndefined();
    expect(parseEmptyActionBody({})).toBeUndefined();

    for (const body of [null, [], "", 0, { reason: "admin" }, { role: "VIEWER" }]) {
      expectValidationFailure(() => parseEmptyActionBody(body));
    }
  });
});
