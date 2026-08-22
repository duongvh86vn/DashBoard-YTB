import { describe, expect, it, vi } from "vitest";

import { SessionRepository } from "./session.repository.js";

describe("SessionRepository", () => {
  it("persists the injected time as both createdAt and lastSeenAt", async () => {
    const now = new Date("2026-08-22T00:30:00.000Z");
    const create = vi.fn(async ({ data }: { data: object }) => ({ id: "session-id", ...data }));
    const repository = new SessionRepository({ session: { create } } as never);

    await repository.create({
      userId: "00000000-0000-4000-8000-000000000002",
      tokenHash: new Uint8Array([1, 2, 3]),
      now,
      idleExpiresAt: new Date("2026-08-22T01:30:00.000Z"),
      absoluteExpiresAt: new Date("2026-08-23T00:30:00.000Z"),
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ createdAt: now, lastSeenAt: now }),
    });
  });

  it("caps a touched idle expiry at the absolute expiry", async () => {
    const absoluteExpiresAt = new Date("2026-08-22T04:00:00.000Z");
    const session = {
      id: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      tokenHash: new Uint8Array([1, 2, 3]),
      createdAt: new Date("2026-08-22T00:00:00.000Z"),
      lastSeenAt: new Date("2026-08-22T00:00:00.000Z"),
      idleExpiresAt: new Date("2026-08-22T01:00:00.000Z"),
      absoluteExpiresAt,
      revokedAt: null,
      revocationReason: null,
    };
    const findUnique = vi.fn(async () => session);
    const update = vi.fn(async ({ data }: { data: { lastSeenAt: Date; idleExpiresAt: Date } }) => ({
      ...session,
      ...data,
    }));
    const repository = new SessionRepository({ session: { findUnique, update } } as never);
    const now = new Date("2026-08-22T00:30:00.000Z");

    await expect(
      repository.touch(session.id, now, new Date("2026-08-22T05:00:00.000Z")),
    ).resolves.toMatchObject({
      lastSeenAt: now,
      idleExpiresAt: absoluteExpiresAt,
    });
  });

  it("returns null instead of touching a missing session", async () => {
    const repository = new SessionRepository({
      session: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(),
      },
    } as never);

    await expect(
      repository.touch(
        "00000000-0000-4000-8000-000000000099",
        new Date("2026-08-22T00:30:00.000Z"),
        new Date("2026-08-22T01:30:00.000Z"),
      ),
    ).resolves.toBeNull();
  });
});
