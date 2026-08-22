import { describe, expect, it } from "vitest";

import { parseRankingQuery, parseVideoId } from "./rankings.schemas.js";

const id = "00000000-0000-4000-8000-000000000001";

describe("video ranking query contracts", () => {
  it("defaults to a bounded server page", () => {
    expect(parseRankingQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(parseRankingQuery({ page: "2", pageSize: "100", channelId: id })).toEqual({
      page: 2,
      pageSize: 100,
      channelId: id,
    });
  });

  it("rejects unsafe or unbounded pagination and malformed ids", () => {
    expect(() => parseRankingQuery({ page: "0" })).toThrowError();
    expect(() => parseRankingQuery({ pageSize: "101" })).toThrowError();
    expect(() => parseVideoId("not-a-uuid")).toThrowError();
  });
});
