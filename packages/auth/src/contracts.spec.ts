import { describe, expect, it } from "vitest";

import {
  CSRF_HEADER_NAME,
  SESSION_COOKIE_LOCAL,
  SESSION_COOKIE_PUBLIC,
} from "./index.js";

describe("auth transport contracts", () => {
  it("uses distinct host-only cookie names for local and public deployments", () => {
    expect(SESSION_COOKIE_LOCAL).toBe("yhm_session");
    expect(SESSION_COOKIE_PUBLIC).toBe("__Host-yhm_session");
  });

  it("uses the required CSRF request-header name", () => {
    expect(CSRF_HEADER_NAME).toBe("x-csrf-protection");
  });
});
