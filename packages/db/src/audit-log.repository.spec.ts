import { describe, expect, it, vi } from "vitest";

import { AuditLogRepository } from "./audit-log.repository.js";

describe("AuditLogRepository", () => {
  it("appends the constrained semantic audit fields", async () => {
    const createdAt = new Date("2026-08-22T00:00:00.000Z");
    const create = vi.fn(async ({ data }: { data: object }) => ({
      id: "00000000-0000-4000-8000-000000000001",
      createdAt,
      ...data,
    }));
    const repository = new AuditLogRepository({ auditLog: { create } } as never);

    await expect(
      repository.append({
        actorUserId: null,
        targetUserId: "00000000-0000-4000-8000-000000000002",
        action: "USER_CREATED",
        outcome: "SUCCESS",
        requestId: "request-1",
        metadata: { source: "bootstrap", count: 1, enabled: true, note: null },
      }),
    ).resolves.toMatchObject({
      actorUserId: null,
      targetUserId: "00000000-0000-4000-8000-000000000002",
      action: "USER_CREATED",
      outcome: "SUCCESS",
      requestId: "request-1",
      metadata: { source: "bootstrap", count: 1, enabled: true, note: null },
      createdAt,
    });
  });
});
