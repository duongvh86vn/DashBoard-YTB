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
    const now = new Date("2026-08-22T00:30:00.000Z");
    const touched = { ...session, lastSeenAt: now, idleExpiresAt: absoluteExpiresAt };
    const queryRaw = vi.fn(async (...parameters: unknown[]) => {
      void parameters;
      return [touched];
    });
    const repository = new SessionRepository({ $queryRaw: queryRaw } as never);

    await expect(
      repository.touch(session.id, now, new Date("2026-08-22T05:00:00.000Z")),
    ).resolves.toMatchObject({
      lastSeenAt: now,
      idleExpiresAt: absoluteExpiresAt,
    });

    expect(queryRaw).toHaveBeenCalledOnce();
    const [query, id, boundNow, requestedIdleExpiry] = queryRaw.mock.calls[0] ?? [];
    expect(Array.from(query as unknown as TemplateStringsArray).join("?")).toMatch(
      /UPDATE "sessions" AS session[\s\S]*LEAST\([\s\S]*FROM "users" AS account[\s\S]*session\."revoked_at" IS NULL[\s\S]*session\."idle_expires_at" >[\s\S]*session\."absolute_expires_at" >[\s\S]*account\."is_enabled" = TRUE/u,
    );
    expect([id, boundNow, requestedIdleExpiry]).toEqual([
      session.id,
      now,
      new Date("2026-08-22T05:00:00.000Z"),
    ]);
  });

  it("returns null when the atomic usable-session update affects no row", async () => {
    const queryRaw = vi.fn(async (...parameters: unknown[]) => {
      void parameters;
      return [];
    });
    const repository = new SessionRepository({ $queryRaw: queryRaw } as never);

    await expect(
      repository.touch(
        "00000000-0000-4000-8000-000000000099",
        new Date("2026-08-22T00:30:00.000Z"),
        new Date("2026-08-22T01:30:00.000Z"),
      ),
    ).resolves.toBeNull();
    expect(queryRaw).toHaveBeenCalledOnce();
  });
});
