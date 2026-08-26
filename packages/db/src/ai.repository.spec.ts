import { describe, expect, it, vi } from "vitest";

import { AiRepository } from "./ai.repository.js";

describe("AiRepository report lookup", () => {
  it("finds the newest report of the requested kind without crossing the request date", async () => {
    const findFirst = vi.fn(async () => null);
    const repository = new AiRepository({ aiReport: { findFirst } } as never);
    const onOrBefore = new Date("2026-08-26T00:00:00.000Z");

    await expect(repository.findLatestReport("WEEKLY", onOrBefore)).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: { kind: "WEEKLY", reportDate: { lte: onOrBefore } },
      orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
    });
  });
});
