import { describe, expect, it } from "vitest";

import {
  CanonicalChannelIdSchema,
  ChannelActivitySchema,
  ChannelAvailabilitySchema,
  CoverageStatusSchema,
  SyncRunJobTypeSchema,
  SyncRunStatusSchema,
} from "./channel-contracts.js";

describe("channel contracts", () => {
  it("accepts only canonical YouTube channel ids", () => {
    expect(CanonicalChannelIdSchema.safeParse("UC1234567890123456789012").success).toBe(true);
    expect(CanonicalChannelIdSchema.safeParse("UCshort").success).toBe(false);
    expect(CanonicalChannelIdSchema.safeParse("PL1234567890123456789012").success).toBe(false);
  });

  it("keeps the spec status vocabularies explicit", () => {
    expect(ChannelAvailabilitySchema.options).toContain("DELETED_OR_TERMINATED");
    expect(ChannelActivitySchema.options).toContain("NO_UPLOAD_HISTORY");
    expect(CoverageStatusSchema.options).toEqual(["COMPLETE", "PARTIAL"]);
    expect(SyncRunJobTypeSchema.options).toContain("CHANNEL_DAILY_FINALIZE");
    expect(SyncRunStatusSchema.options).toEqual([
      "QUEUED",
      "RUNNING",
      "SUCCESS",
      "PARTIAL",
      "FAILED",
    ]);
  });
});
