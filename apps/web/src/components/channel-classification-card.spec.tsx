// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ChannelClassificationCard,
  parseChannelClassification,
} from "./channel-classification-card.js";

afterEach(cleanup);

describe("ChannelClassificationCard", () => {
  it("renders the structured channel classification returned by the API", () => {
    render(
      <ChannelClassificationCard
        result={{
          cached: true,
          classification: {
            primaryNiche: "Nông nghiệp",
            subNiches: ["Chăn nuôi gà", "Trang trại"],
            language: "vi",
            contentFormat: "Video dài hướng dẫn",
            confidence: 0.91,
          },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Phân loại nội dung" })).toBeInTheDocument();
    expect(screen.getByText("Nông nghiệp")).toBeInTheDocument();
    expect(screen.getByText("Chăn nuôi gà")).toBeInTheDocument();
    expect(screen.getByText("91% tin cậy · cache")).toBeInTheDocument();
  });

  it("rejects malformed AI output instead of showing partial claims", () => {
    expect(
      parseChannelClassification({
        classification: { primaryNiche: "Nông nghiệp", confidence: 2 },
      }),
    ).toBeNull();
  });
});
