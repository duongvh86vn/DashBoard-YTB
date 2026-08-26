import { describe, expect, it } from "vitest";

import {
  parseCreateChannelBody,
  parseListChannelsQuery,
  parsePublicIntelligenceQuery,
} from "./channels.schemas.js";

const groupId = "00000000-0000-4000-8000-000000000001";
const channelId = "00000000-0000-4000-8000-000000000002";

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
    expect(parseListChannelsQuery({ groupId, channelId })).toEqual({
      page: 1,
      pageSize: 20,
      groupId,
      channelId,
    });
    expect(parsePublicIntelligenceQuery({})).toEqual({ days: 30 });
    expect(parsePublicIntelligenceQuery({ days: "7" })).toEqual({ days: 7 });
  });

  it("rejects extra fields and unsafe pagination", () => {
    expect(() => parseCreateChannelBody({ channelUrl: "@example", role: "ADMIN" })).toThrow();
    expect(() => parseListChannelsQuery({ page: "01" })).toThrow();
    expect(() => parseListChannelsQuery({ pageSize: "101" })).toThrow();
    expect(() => parseListChannelsQuery({ groupId: "not-a-uuid" })).toThrow();
    expect(() => parsePublicIntelligenceQuery({ days: "91" })).toThrow();
    expect(() => parsePublicIntelligenceQuery({ days: "01" })).toThrow();
    expect(() => parsePublicIntelligenceQuery({ days: "30", estimateRevenue: "true" })).toThrow();
  });
});
