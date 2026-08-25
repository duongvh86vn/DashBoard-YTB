import { describe, expect, it } from "vitest";

import { parsePublicPageMetrics } from "./metrics.js";

describe("public page metric parser", () => {
  it("parses compact visible metrics and leaves missing values null", () => {
    expect(parsePublicPageMetrics("1.2K subscribers\n45 videos")).toEqual({
      subscriberCount: 1200n,
      videoCount: 45n,
      lifetimeViewCount: null,
    });
    expect(parsePublicPageMetrics("Channel title only")).toEqual({
      subscriberCount: null,
      videoCount: null,
      lifetimeViewCount: null,
    });
  });

  it("parses public lifetime channel views without inventing missing values", () => {
    expect(parsePublicPageMetrics("1.2K subscribers\n45 videos\n12,345,678 views")).toEqual({
      subscriberCount: 1200n,
      videoCount: 45n,
      lifetimeViewCount: 12_345_678n,
    });
  });
});
