import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { seedInitialAdmin } from "./seed-admin.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database integration tests");
}

const client = createPrismaClient(databaseUrl);

describe("seedInitialAdmin integration", () => {
  beforeEach(async () => {
    await client.auditLog.deleteMany();
    await client.session.deleteMany();
    await client.user.deleteMany();
  });

  afterAll(async () => {
    await client.auditLog.deleteMany();
    await client.session.deleteMany();
    await client.user.deleteMany();
    await client.$disconnect();
  });

  it("converges concurrent empty-store bootstrap attempts to one ADMIN", async () => {
    const input = {
      email: " Admin@Example.COM ",
      password: "correct horse battery staple",
    };

    const results = await Promise.all([
      seedInitialAdmin(input, { client }),
      seedInitialAdmin(input, { client }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["CREATED", "UNCHANGED"]);
    await expect(client.user.findMany()).resolves.toMatchObject([
      {
        email: "admin@example.com",
        role: "ADMIN",
        isEnabled: true,
        disabledAt: null,
      },
    ]);
  });

  it("does not silently reset the sole matching active ADMIN password", async () => {
    const existing = await client.user.create({
      data: {
        email: "admin@example.com",
        passwordHash: "existing-password-hash",
        role: "ADMIN",
      },
    });

    await expect(
      seedInitialAdmin(
        { email: "admin@example.com", password: "a different valid password" },
        { client },
      ),
    ).resolves.toEqual({ status: "UNCHANGED" });
    await expect(client.user.findUnique({ where: { id: existing.id } })).resolves.toMatchObject({
      passwordHash: "existing-password-hash",
      isEnabled: true,
    });
  });
});
