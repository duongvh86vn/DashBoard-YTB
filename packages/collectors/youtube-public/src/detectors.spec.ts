import { describe, expect, it } from "vitest";

import { detectPublicPage } from "./detectors.js";

const page = {
  requestedUrl: "https://www.youtube.com/@example",
  finalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
  httpStatus: 200,
  title: "Example channel",
  visibleText: "Example channel\n1.2K subscribers",
  durationMs: 42,
};

describe("public page health detectors", () => {
  it("detects a rendered public channel from canonical identity", () => {
    expect(detectPublicPage(page)).toEqual({
      kind: "RENDERED",
      channelId: "UC1234567890123456789012",
    });
  });

  it("classifies CAPTCHA/block pages without bypass", () => {
    expect(detectPublicPage({ ...page, visibleText: "Verify you are human" })).toEqual({
      kind: "BLOCKED",
      channelId: null,
    });
  });

  it("distinguishes terminated and not-found pages", () => {
    expect(detectPublicPage({ ...page, visibleText: "Channel has been terminated" })).toMatchObject(
      {
        kind: "TERMINATED",
      },
    );
    expect(
      detectPublicPage({ ...page, httpStatus: 404, visibleText: "This page isn't available" }),
    ).toMatchObject({ kind: "NOT_FOUND" });
  });

  it("does not store or require full HTML", () => {
    expect(
      detectPublicPage({ ...page, finalUrl: "https://www.youtube.com/@example", visibleText: "" }),
    ).toEqual({ kind: "CHECK_FAILED", channelId: null });
  });
});
