import { describe, expect, it } from "vitest";

import * as rankingSchemas from "./rankings.schemas.js";

const { parseRankingQuery, parseVideoId } = rankingSchemas;

const id = "00000000-0000-4000-8000-000000000001";
const groupId = "00000000-0000-4000-8000-000000000002";

describe("video ranking query contracts", () => {
  it("defaults to a bounded server page", () => {
    expect(parseRankingQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(parseRankingQuery({ page: "2", pageSize: "100", groupId, channelId: id })).toEqual({
      page: 2,
      pageSize: 100,
      groupId,
      channelId: id,
    });
  });

  it("rejects unsafe or unbounded pagination and malformed ids", () => {
    expect(() => parseRankingQuery({ page: "0" })).toThrowError();
    expect(() => parseRankingQuery({ pageSize: "101" })).toThrowError();
    expect(() => parseRankingQuery({ groupId: "not-a-uuid" })).toThrowError();
    expect(() => parseVideoId("not-a-uuid")).toThrowError();
  });

  it.each([
    ["group", { groupId }],
    ["channel", { channelId: id }],
  ])("keeps snapshot history pagination-only by rejecting a %s selector", (_name, query) => {
    const parser: unknown = Reflect.get(rankingSchemas, "parseSnapshotHistoryQuery");
    expect(parser).toBeTypeOf("function");
    if (typeof parser !== "function") return;

    expect(() => parser(query)).toThrowError(
      expect.objectContaining({ code: "CHANNEL_INPUT_INVALID", status: 400 }),
    );
  });
});
