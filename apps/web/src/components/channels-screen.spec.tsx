// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../lib/auth-context.js";
import { ChannelsScreen } from "./channels-screen.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function authResponse() {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000002",
      email: "viewer@example.com",
      role: "VIEWER",
      isEnabled: true,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      disabledAt: null,
    },
  };
}

function channel(input: {
  id: string;
  title: string;
  subscriberCount: string | null;
  lastChannelScanAt: string | null;
}) {
  return {
    id: input.id,
    youtubeChannelId: `UC${input.id.replaceAll("-", "").slice(0, 22)}`,
    originalInput: `@${input.id}`,
    canonicalUrl: `https://www.youtube.com/channel/UC${input.id.replaceAll("-", "").slice(0, 22)}`,
    handle: `@${input.id}`,
    title: input.title,
    description: null,
    thumbnail: null,
    subscriberCount: input.subscriberCount,
    videoCount: "2",
    lifetimeViewCount: "50",
    lastUploadAt: null,
    availabilityStatus: "ACTIVE",
    activityStatus: "ACTIVE_RECENT",
    lastChannelScanAt: input.lastChannelScanAt,
    lastHealthCheckAt: null,
    lastSeenAliveAt: input.lastChannelScanAt,
    isEnabled: true,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-24T09:00:00.000Z",
    archivedAt: null,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChannelsScreen subscriber availability", () => {
  it("distinguishes an explicit zero from uncollected and unreadable public values", async () => {
    const items = [
      channel({
        id: "00000000-0000-4000-8000-000000000010",
        title: "Kênh số không",
        subscriberCount: "0",
        lastChannelScanAt: "2026-08-24T09:00:00.000Z",
      }),
      channel({
        id: "00000000-0000-4000-8000-000000000011",
        title: "Kênh chưa quét",
        subscriberCount: null,
        lastChannelScanAt: null,
      }),
      channel({
        id: "00000000-0000-4000-8000-000000000012",
        title: "Kênh không đọc được",
        subscriberCount: null,
        lastChannelScanAt: "2026-08-24T09:00:00.000Z",
      }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/v1/auth/me") return Promise.resolve(jsonResponse(authResponse()));
        if (path === "/api/v1/channels?page=1&pageSize=20") {
          return Promise.resolve(
            jsonResponse({ items, page: 1, pageSize: 20, total: items.length }),
          );
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );

    render(
      <AuthProvider>
        <ChannelsScreen />
      </AuthProvider>,
    );

    const zeroCard = (await screen.findByRole("heading", { name: "Kênh số không" })).closest(
      "article",
    );
    const uncollectedCard = screen
      .getByRole("heading", { name: "Kênh chưa quét" })
      .closest("article");
    const unreadableCard = screen
      .getByRole("heading", { name: "Kênh không đọc được" })
      .closest("article");

    expect(zeroCard).not.toBeNull();
    expect(uncollectedCard).not.toBeNull();
    expect(unreadableCard).not.toBeNull();
    expect(within(zeroCard!).getByText("0")).toBeInTheDocument();
    expect(within(uncollectedCard!).getByText("Chưa thu thập")).toBeInTheDocument();
    expect(within(unreadableCard!).getByText("Không đọc được công khai")).toBeInTheDocument();
  });
});
