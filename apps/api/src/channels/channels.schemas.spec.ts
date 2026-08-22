import { describe, expect, it } from "vitest";

import { parseCreateChannelBody, parseListChannelsQuery } from "./channels.schemas.js";

describe("channel request schemas", () => {
  it("accepts the exact add-channel body and strict pagination", () => {
    expect(parseCreateChannelBody({ channelUrl: " @example " })).toEqual({
      channelUrl: "@example",
    });
    expect(parseListChannelsQuery({ page: "2", pageSize: "10" })).toEqual({
      page: 2,
      pageSize: 10,
    });
    expect(parseListChannelsQuery({})).toEqual({ page: 1, pageSize: 20 });
  });

  it("rejects extra fields and unsafe pagination", () => {
    expect(() => parseCreateChannelBody({ channelUrl: "@example", role: "ADMIN" })).toThrow();
    expect(() => parseListChannelsQuery({ page: "01" })).toThrow();
    expect(() => parseListChannelsQuery({ pageSize: "101" })).toThrow();
  });
});
