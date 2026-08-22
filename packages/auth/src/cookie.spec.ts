import { describe, expect, it } from "vitest";

import { createSessionCookiePolicy } from "./index.js";

describe("session cookie policy", () => {
  it("uses the non-Secure local host-only cookie policy", () => {
    const policy = createSessionCookiePolicy("LOCAL", 24);

    expect(policy).toEqual({
      name: "yhm_session",
      options: {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
        maxAge: 86_400,
      },
    });
    expect(policy.options).not.toHaveProperty("domain");
  });

  it("uses the Secure public __Host cookie policy without a Domain field", () => {
    const policy = createSessionCookiePolicy("PUBLIC", 12);

    expect(policy).toEqual({
      name: "__Host-yhm_session",
      options: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 43_200,
      },
    });
    expect(policy.options).not.toHaveProperty("domain");
  });
});
