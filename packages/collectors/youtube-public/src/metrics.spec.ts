import { describe, expect, it } from "vitest";

import { parsePublicPageMetrics } from "./metrics.js";

describe("public page metric parser", () => {
  it("parses compact visible metrics and leaves missing values null", () => {
    expect(parsePublicPageMetrics("1.2K subscribers\n45 videos")).toEqual({
      subscriberCount: 1200n,
      videoCount: 45n,
    });
    expect(parsePublicPageMetrics("Channel title only")).toEqual({
      subscriberCount: null,
      videoCount: null,
    });
  });
});
