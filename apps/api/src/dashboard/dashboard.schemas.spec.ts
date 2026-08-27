import { describe, expect, it } from "vitest";

import {
  parseDailyVideoLeadersQuery,
  parseDashboardRevenueQuery,
  parseDashboardTrendsQuery,
} from "./dashboard.schemas.js";

const groupId = "00000000-0000-4000-8000-000000000001";
const channelId = "00000000-0000-4000-8000-000000000002";

describe("dashboard trend query", () => {
  it("defaults to 28 days and accepts a bounded explicit period", () => {
    expect(parseDashboardTrendsQuery({})).toEqual({ days: 28 });
    expect(parseDashboardTrendsQuery({ days: "7" })).toEqual({ days: 7 });
    expect(parseDashboardTrendsQuery({ days: "90" })).toEqual({ days: 90 });
  });

  it("accepts optional group and channel selectors together", () => {
    expect(parseDashboardTrendsQuery({ days: "28", groupId, channelId })).toEqual({
      days: 28,
      groupId,
      channelId,
    });
  });

  it("rejects unsafe, zero, oversized and extra values", () => {
    expect(() => parseDashboardTrendsQuery({ days: "0" })).toThrow();
    expect(() => parseDashboardTrendsQuery({ days: "91" })).toThrow();
    expect(() => parseDashboardTrendsQuery({ groupId: "not-a-uuid" })).toThrow();
    expect(() => parseDashboardTrendsQuery({ channelId: "not-a-uuid" })).toThrow();
    expect(() => parseDashboardTrendsQuery({ days: "28", revenue: "true" })).toThrow();
  });
});

describe("dashboard revenue query", () => {
  it("uses the same bounded period and exact scope contract as trends", () => {
    expect(parseDashboardRevenueQuery({})).toEqual({ days: 28 });
    expect(parseDashboardRevenueQuery({ days: "7", groupId, channelId })).toEqual({
      days: 7,
      groupId,
      channelId,
    });
    expect(() => parseDashboardRevenueQuery({ days: "91" })).toThrow();
    expect(() => parseDashboardRevenueQuery({ days: "7", currency: "VND" })).toThrow();
  });
});

describe("daily video leaders query", () => {
  it("accepts only the optional group and channel scope", () => {
    expect(parseDailyVideoLeadersQuery({})).toEqual({});
    expect(parseDailyVideoLeadersQuery({ groupId, channelId })).toEqual({ groupId, channelId });
    expect(() => parseDailyVideoLeadersQuery({ days: "28" })).toThrow();
    expect(() => parseDailyVideoLeadersQuery({ groupId: "not-a-uuid" })).toThrow();
  });
});
