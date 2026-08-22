import { describe, expect, it, vi } from "vitest";

import { seedInitialAdmin, type SeedAdminDependencies } from "./seed-admin.js";

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  role: "ADMIN" | "VIEWER";
  isEnabled: boolean;
  disabledAt: Date | null;
}

function createDependencies(initialUsers: StoredUser[] = []) {
  const users = [...initialUsers];
  const hashPassword = vi.fn(async () => "argon2-hash");
  const lock = vi.fn(async () => 1);
  const transaction = vi.fn(async (work: (transactionClient: unknown) => Promise<unknown>) =>
    work({
      $executeRaw: lock,
      user: {
        count: vi.fn(async (input?: { where?: { role?: "ADMIN" } }) =>
          input?.where?.role === "ADMIN"
            ? users.filter((user) => user.role === "ADMIN").length
            : users.length,
        ),
        findMany: vi.fn(async (input?: { where?: { role?: "ADMIN" } }) =>
          input?.where?.role === "ADMIN"
            ? users.filter((user) => user.role === "ADMIN")
            : [...users],
        ),
        create: vi.fn(async ({ data }: { data: Omit<StoredUser, "id" | "disabledAt"> }) => {
          const user = {
            id: `00000000-0000-4000-8000-${String(users.length + 1).padStart(12, "0")}`,
            disabledAt: null,
            ...data,
          };
          users.push(user);
          return user;
        }),
      },
    }),
  );
  const dependencies = {
    client: { $transaction: transaction } as never,
    hashPassword,
  } satisfies SeedAdminDependencies;

  return { dependencies, hashPassword, lock, transaction, users };
}

const validInput = {
  email: " Admin@Example.COM ",
  password: "correct horse battery staple",
};

describe("seedInitialAdmin", () => {
  it("creates exactly one normalized active ADMIN in an empty identity store", async () => {
    const fake = createDependencies();

    await expect(seedInitialAdmin(validInput, fake.dependencies)).resolves.toEqual({
      status: "CREATED",
    });
    expect(fake.users).toEqual([
      expect.objectContaining({
        email: "admin@example.com",
        passwordHash: "argon2-hash",
        role: "ADMIN",
        isEnabled: true,
        disabledAt: null,
      }),
    ]);
    expect(fake.lock).toHaveBeenCalledOnce();
  });

  it("leaves the password unchanged for the sole matching active ADMIN", async () => {
    const existing = {
      id: "00000000-0000-4000-8000-000000000001",
      email: "admin@example.com",
      passwordHash: "existing-hash",
      role: "ADMIN" as const,
      isEnabled: true,
      disabledAt: null,
    };
    const fake = createDependencies([existing]);
    fake.hashPassword.mockRejectedValue(new Error("hashing must not run for UNCHANGED"));

    await expect(seedInitialAdmin(validInput, fake.dependencies)).resolves.toEqual({
      status: "UNCHANGED",
    });
    expect(fake.users[0]?.passwordHash).toBe("existing-hash");
    expect(fake.hashPassword).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "users but no ADMIN",
      users: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          email: "viewer@example.com",
          passwordHash: "viewer-hash",
          role: "VIEWER" as const,
          isEnabled: true,
          disabledAt: null,
        },
      ],
    },
    {
      name: "a different ADMIN email",
      users: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          email: "other-admin@example.com",
          passwordHash: "admin-hash",
          role: "ADMIN" as const,
          isEnabled: true,
          disabledAt: null,
        },
      ],
    },
    {
      name: "the matching email assigned VIEWER",
      users: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          email: "admin@example.com",
          passwordHash: "viewer-hash",
          role: "VIEWER" as const,
          isEnabled: true,
          disabledAt: null,
        },
      ],
    },
    {
      name: "a disabled matching ADMIN",
      users: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          email: "admin@example.com",
          passwordHash: "admin-hash",
          role: "ADMIN" as const,
          isEnabled: false,
          disabledAt: new Date("2026-08-22T00:00:00.000Z"),
        },
      ],
    },
    {
      name: "multiple ADMIN rows",
      users: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          email: "admin@example.com",
          passwordHash: "first-hash",
          role: "ADMIN" as const,
          isEnabled: true,
          disabledAt: null,
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          email: "other-admin@example.com",
          passwordHash: "second-hash",
          role: "ADMIN" as const,
          isEnabled: true,
          disabledAt: null,
        },
      ],
    },
  ])("rejects $name without mutating identities", async ({ users }) => {
    const fake = createDependencies(users);
    const before = structuredClone(fake.users);

    await expect(seedInitialAdmin(validInput, fake.dependencies)).rejects.toMatchObject({
      name: "SeedAdminConflictError",
      code: "SEED_ADMIN_CONFLICT",
    });
    expect(fake.users).toEqual(before);
    expect(fake.hashPassword).not.toHaveBeenCalled();
  });

  it("validates the password before opening a transaction", async () => {
    const fake = createDependencies();

    await expect(
      seedInitialAdmin({ email: "admin@example.com", password: "too-short" }, fake.dependencies),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fake.transaction).not.toHaveBeenCalled();
  });
});
