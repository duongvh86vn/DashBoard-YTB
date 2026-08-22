import { describe, expect, it } from "vitest";

import { shouldCaptureSnapshot, snapshotBucket, snapshotIntervalMs } from "./snapshot-bucket.js";

describe("video snapshot buckets", () => {
  it("floors captures into one deterministic hourly bucket", () => {
    expect(snapshotBucket(new Date("2026-08-22T01:59:59.999Z")).toISOString()).toBe(
      "2026-08-22T01:00:00.000Z",
    );
    expect(snapshotBucket(new Date("2026-08-22T02:00:00.000Z")).toISOString()).toBe(
      "2026-08-22T02:00:00.000Z",
    );
  });

  it("uses HOT/WARM/old-HOT intervals and never schedules archived videos", () => {
    expect(snapshotIntervalMs("HOT")).toBe(60 * 60 * 1000);
    expect(snapshotIntervalMs("WARM")).toBe(3 * 60 * 60 * 1000);
    expect(snapshotIntervalMs("OLD_HOT")).toBe(6 * 60 * 60 * 1000);
    expect(snapshotIntervalMs("PINNED")).toBe(6 * 60 * 60 * 1000);
    expect(snapshotIntervalMs("ARCHIVED")).toBeNull();
    expect(shouldCaptureSnapshot("ARCHIVED", new Date(), null)).toBe(false);
  });

  it("does not duplicate a bucket when the last capture is recent", () => {
    const now = new Date("2026-08-22T04:00:00.000Z");
    expect(shouldCaptureSnapshot("HOT", now, new Date("2026-08-22T03:30:00.000Z"))).toBe(false);
    expect(shouldCaptureSnapshot("HOT", now, new Date("2026-08-22T03:00:00.000Z"))).toBe(true);
  });
});
