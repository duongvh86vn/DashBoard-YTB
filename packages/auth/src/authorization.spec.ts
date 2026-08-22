import { describe, expect, it } from "vitest";

import { canManageUsers } from "./index.js";

describe("user-management authorization", () => {
  it("allows ADMIN to manage users", () => {
    expect(canManageUsers("ADMIN")).toBe(true);
  });

  it("prevents VIEWER from managing users", () => {
    expect(canManageUsers("VIEWER")).toBe(false);
  });
});
