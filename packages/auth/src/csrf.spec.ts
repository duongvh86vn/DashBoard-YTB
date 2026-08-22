import { describe, expect, it } from "vitest";

import { validateCsrfRequest, type CsrfRequestInput } from "./index.js";

const validUnsafeRequest: CsrfRequestInput = {
  method: "POST",
  origin: "https://app.example.test",
  contentType: "application/json",
  protectionHeader: "1",
  allowedOrigins: ["https://app.example.test"],
};

describe("CSRF request validation", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("allows safe %s requests without CSRF headers", (method) => {
    expect(
      validateCsrfRequest({
        method,
        origin: undefined,
        contentType: undefined,
        protectionHeader: undefined,
        allowedOrigins: [],
      }),
    ).toBe(true);
  });

  it.each(["get", "gEt", "head", "options"])(
    "does not exempt case-variant method token %s from unsafe validation",
    (method) => {
      expect(
        validateCsrfRequest({
          method,
          origin: undefined,
          contentType: undefined,
          protectionHeader: undefined,
          allowedOrigins: [],
        }),
      ).toBe(false);
    },
  );

  it("allows an unsafe JSON request with an exact allowed origin and protection header", () => {
    expect(validateCsrfRequest(validUnsafeRequest)).toBe(true);
  });

  it("allows a JSON content type with an optional charset parameter", () => {
    expect(
      validateCsrfRequest({
        ...validUnsafeRequest,
        contentType: "application/json; charset=utf-8",
      }),
    ).toBe(true);
  });

  it("rejects an unsafe request when the origin is not an exact allowed value", () => {
    expect(
      validateCsrfRequest({
        ...validUnsafeRequest,
        origin: "https://evil.test",
      }),
    ).toBe(false);
    expect(
      validateCsrfRequest({
        ...validUnsafeRequest,
        origin: "https://app.example.test.evil.test",
      }),
    ).toBe(false);
  });

  it("rejects unsafe requests without an origin or exact protection header", () => {
    expect(validateCsrfRequest({ ...validUnsafeRequest, origin: undefined })).toBe(false);
    expect(validateCsrfRequest({ ...validUnsafeRequest, protectionHeader: undefined })).toBe(false);
    expect(validateCsrfRequest({ ...validUnsafeRequest, protectionHeader: "01" })).toBe(false);
  });

  it("rejects unsafe requests whose media type is not application/json", () => {
    expect(validateCsrfRequest({ ...validUnsafeRequest, contentType: "text/plain" })).toBe(false);
    expect(
      validateCsrfRequest({ ...validUnsafeRequest, contentType: "application/json-patch+json" }),
    ).toBe(false);
    expect(
      validateCsrfRequest({ ...validUnsafeRequest, contentType: "application/json; boundary=x" }),
    ).toBe(false);
  });
});
