import { describe, expect, it, vi } from "vitest";

import { UserRepository } from "./user.repository.js";

const userRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "viewer@example.com",
  passwordHash: "password-hash",
  role: "VIEWER" as const,
  isEnabled: true,
  createdAt: new Date("2026-08-22T00:00:00.000Z"),
  updatedAt: new Date("2026-08-22T00:00:00.000Z"),
  disabledAt: null,
};

describe("UserRepository", () => {
  it("maps a duplicate canonical email to USER_ALREADY_EXISTS", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(userRecord)
      .mockRejectedValueOnce(Object.assign(new Error("unique constraint"), { code: "P2002" }));
    const repository = new UserRepository({ user: { create } } as never);

    await repository.create({
      email: "viewer@example.com",
      passwordHash: "password-hash",
      role: "VIEWER",
    });

    await expect(
      repository.create({
        email: "viewer@example.com",
        passwordHash: "another-password-hash",
        role: "VIEWER",
      }),
    ).rejects.toMatchObject({
      name: "IdentityConflictError",
      code: "USER_ALREADY_EXISTS",
    });
  });

  it("maps a missing user update to USER_NOT_FOUND", async () => {
    const update = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("record not found"), { code: "P2025" }));
    const repository = new UserRepository({ user: { update } } as never);

    await expect(
      repository.updateEmail("00000000-0000-4000-8000-000000000099", "new@example.com"),
    ).rejects.toMatchObject({
      name: "IdentityNotFoundError",
      code: "USER_NOT_FOUND",
    });
  });

  it("sets and clears disabledAt together with isEnabled", async () => {
    const update = vi
      .fn()
      .mockImplementation(({ data }: { data: { isEnabled: boolean; disabledAt: Date | null } }) =>
        Promise.resolve({ ...userRecord, ...data }),
      );
    const repository = new UserRepository({ user: { update } } as never);
    const now = new Date("2026-08-22T01:02:03.000Z");

    await expect(repository.setEnabled(userRecord.id, false, now)).resolves.toMatchObject({
      isEnabled: false,
      disabledAt: now,
    });
    await expect(repository.setEnabled(userRecord.id, true, now)).resolves.toMatchObject({
      isEnabled: true,
      disabledAt: null,
    });
  });
});
