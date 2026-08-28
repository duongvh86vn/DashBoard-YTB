// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../lib/auth-context.js";
import { ChannelsScreen } from "./channels-screen.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function authResponse(role: "ADMIN" | "VIEWER" = "VIEWER") {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000002",
      email: "viewer@example.com",
      role,
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
  videoCount?: string | null;
  lastChannelScanAt: string | null;
  monetization?: {
    status: "UNCONFIGURED" | "DISABLED" | "ENABLED";
    isMonetized: boolean | null;
    rpmUsd: string | null;
    currency: "USD" | null;
    effectiveDate: string | null;
    reviewedAt: string | null;
  };
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
    videoCount: input.videoCount === undefined ? "2" : input.videoCount,
    lifetimeViewCount: "50",
    lastUploadAt: null,
    availabilityStatus: "ACTIVE",
    activityStatus: "ACTIVE_RECENT",
    lastChannelScanAt: input.lastChannelScanAt,
    lastHealthCheckAt: null,
    lastSeenAliveAt: input.lastChannelScanAt,
    monetization: input.monetization ?? {
      status: "UNCONFIGURED",
      isMonetized: null,
      rpmUsd: null,
      currency: null,
      effectiveDate: null,
      reviewedAt: null,
    },
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
  it("lets ADMIN record a manual RPM with an effective date and renders the saved evidence", async () => {
    const item = channel({
      id: "00000000-0000-4000-8000-000000000010",
      title: "Kênh kiếm tiền",
      subscriberCount: "1200",
      lastChannelScanAt: "2026-08-24T09:00:00.000Z",
    });
    const saved = {
      ...item,
      monetization: {
        status: "ENABLED" as const,
        isMonetized: true,
        rpmUsd: "1.25",
        currency: "USD" as const,
        effectiveDate: "2026-08-27",
        reviewedAt: "2026-08-27T03:00:00.000Z",
      },
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const path = String(input);
      if (path === "/api/v1/auth/me") return Promise.resolve(jsonResponse(authResponse("ADMIN")));
      if (path === "/api/v1/channels?page=1&pageSize=20") {
        return Promise.resolve(jsonResponse({ items: [item], page: 1, pageSize: 20, total: 1 }));
      }
      if (path === `/api/v1/channels/${item.id}/monetization`) {
        return Promise.resolve(jsonResponse({ channel: saved }));
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <ChannelsScreen />
      </AuthProvider>,
    );

    const status = await screen.findByRole("combobox", {
      name: "Trạng thái kiếm tiền của Kênh kiếm tiền",
    });
    fireEvent.change(status, { target: { value: "ENABLED" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "RPM USD" }), {
      target: { value: "1.25" },
    });
    fireEvent.change(screen.getByLabelText("Ngày hiệu lực"), {
      target: { value: "2026-08-27" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu kiếm tiền" }));

    await screen.findByText("Đã cập nhật RPM thủ công.");
    const monetizationCall = fetchMock.mock.calls.find(
      ([path]) => String(path) === `/api/v1/channels/${item.id}/monetization`,
    );
    expect(monetizationCall).toBeDefined();
    const init = monetizationCall?.[1] as RequestInit;
    expect(init.body).toBe(
      JSON.stringify({ isMonetized: true, rpmUsd: "1.25", effectiveDate: "2026-08-27" }),
    );
    expect(screen.getByText("RPM hiện tại: 1.25 USD")).toBeInTheDocument();
  });

  it("keeps monetization evidence read-only for VIEWER accounts", async () => {
    const item = channel({
      id: "00000000-0000-4000-8000-000000000010",
      title: "Kênh chỉ đọc",
      subscriberCount: "1200",
      lastChannelScanAt: "2026-08-24T09:00:00.000Z",
      monetization: {
        status: "DISABLED",
        isMonetized: false,
        rpmUsd: null,
        currency: "USD",
        effectiveDate: "2026-08-20",
        reviewedAt: "2026-08-20T03:00:00.000Z",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/v1/auth/me") return Promise.resolve(jsonResponse(authResponse()));
        if (path === "/api/v1/channels?page=1&pageSize=20") {
          return Promise.resolve(jsonResponse({ items: [item], page: 1, pageSize: 20, total: 1 }));
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );

    render(
      <AuthProvider>
        <ChannelsScreen />
      </AuthProvider>,
    );

    expect(await screen.findByText("Chưa bật kiếm tiền")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lưu kiếm tiền" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: /Trạng thái kiếm tiền/u }),
    ).not.toBeInTheDocument();
  });

  it("displays missing public values as zero while retaining an explanatory qualifier", async () => {
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
        videoCount: null,
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
    expect(within(uncollectedCard!).getAllByText("0")).toHaveLength(2);
    expect(within(unreadableCard!).getByText("0")).toBeInTheDocument();
    expect(within(uncollectedCard!).getAllByText("chưa có dữ liệu")).toHaveLength(2);
    expect(within(unreadableCard!).getByText("chưa có dữ liệu")).toBeInTheDocument();
    expect(within(uncollectedCard!).getByTitle(/chưa được thu thập/u)).toBeInTheDocument();
    expect(within(unreadableCard!).getByTitle(/không đọc được công khai/u)).toBeInTheDocument();
  });
});
