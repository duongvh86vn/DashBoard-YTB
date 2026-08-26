import { describe, expect, it } from "vitest";

import {
  parseCreateChannelGroupBody,
  parseReplaceChannelsBody,
  parseReplaceViewerGroupsBody,
  parseUpdateChannelGroupBody,
} from "./channel-groups.schemas.js";

const FIRST_ID = "00000000-0000-4000-8000-000000000001";

describe("channel group request schemas", () => {
  it("normalizes create input and rejects unknown fields", () => {
    expect(parseCreateChannelGroupBody({ name: "  Truyện audio  " })).toEqual({
      name: "Truyện audio",
      description: null,
    });
    expect(() =>
      parseCreateChannelGroupBody({ name: "Truyện audio", unrestricted: true }),
    ).toThrow();
  });

  it("requires at least one update field", () => {
    expect(() => parseUpdateChannelGroupBody({})).toThrow();
    expect(parseUpdateChannelGroupBody({ description: null })).toEqual({ description: null });
  });

  it("accepts empty atomic replacements and rejects duplicate identifiers", () => {
    expect(parseReplaceChannelsBody({ channelIds: [] })).toEqual({ channelIds: [] });
    expect(parseReplaceViewerGroupsBody({ groupIds: [FIRST_ID] })).toEqual({
      groupIds: [FIRST_ID],
    });
    expect(() => parseReplaceChannelsBody({ channelIds: [FIRST_ID, FIRST_ID] })).toThrow();
  });
});
