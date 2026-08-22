import { describe, expect, it } from "vitest";

import { SessionCookieService, type CookieResponse } from "./session-cookie.service.js";

class RecordingResponse implements CookieResponse {
  headers = new Map<string, string | readonly string[]>();

  setHeader(name: string, value: string | readonly string[]): void {
    this.headers.set(name.toLowerCase(), value);
  }
}

describe("SessionCookieService", () => {
  it("sets only the host-only LOCAL cookie with absolute Max-Age attributes", () => {
    const response = new RecordingResponse();
    const service = new SessionCookieService("LOCAL", 24);

    service.set(response, "a".repeat(43));

    const header = response.headers.get("set-cookie");
    expect(header).toBe(
      `yhm_session=${"a".repeat(43)}; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax`,
    );
    expect(String(header)).not.toMatch(/Domain|Secure|__Host-yhm_session/u);
  });

  it("sets only the Secure __Host cookie in PUBLIC mode", () => {
    const response = new RecordingResponse();
    const service = new SessionCookieService("PUBLIC", 24);

    service.set(response, "b".repeat(43));

    const header = String(response.headers.get("set-cookie"));
    expect(header).toBe(
      `__Host-yhm_session=${"b".repeat(43)}; Max-Age=86400; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(header).not.toMatch(/Domain/u);
    expect(header).not.toMatch(/^yhm_session=/u);
  });

  it("clears only the active name with epoch Expires and matching attributes", () => {
    const local = new RecordingResponse();
    const publicResponse = new RecordingResponse();

    new SessionCookieService("LOCAL", 24).clear(local);
    new SessionCookieService("PUBLIC", 24).clear(publicResponse);

    expect(local.headers.get("set-cookie")).toBe(
      "yhm_session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
    );
    expect(publicResponse.headers.get("set-cookie")).toBe(
      "__Host-yhm_session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
    );
  });
});
