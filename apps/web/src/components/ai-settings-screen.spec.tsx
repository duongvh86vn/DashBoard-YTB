// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiSettingsScreen } from "./ai-settings-screen.js";

const api = vi.hoisted(() => ({
  discoverAiModels: vi.fn(),
  getAiStatus: vi.fn(),
  testAiProvider: vi.fn(),
  updateAiSettings: vi.fn(),
}));

vi.mock("../lib/api-client", () => ({
  ...api,
  getVietnameseApiMessage: () => "Không thể tải cấu hình AI.",
}));

const status = {
  available: true,
  message: null,
  providers: [
    {
      provider: "GEMINI",
      status: "HEALTHY",
      configured: true,
      enabled: true,
      priority: 1,
      model: null,
      apiKeyMasked: "****1234",
      code: null,
    },
    {
      provider: "NVIDIA",
      status: "HEALTHY",
      configured: true,
      enabled: true,
      priority: 2,
      model: "nvidia/saved-model",
      apiKeyMasked: "****5678",
      code: null,
    },
  ],
} as const;

const geminiModels = [
  {
    id: "gemini/fast-model",
    label: "Gemini nhanh",
    description: "Phù hợp tác vụ nhanh.",
    recommended: false,
    source: "BUNDLED",
  },
  {
    id: "gemini/recommended-model",
    label: "Gemini cân bằng",
    description: "Lựa chọn mặc định.",
    recommended: true,
    source: "BUNDLED",
  },
] as const;

const nvidiaModels = [
  {
    id: "nvidia/saved-model",
    label: "NVIDIA đã lưu",
    recommended: false,
    source: "BUNDLED",
  },
] as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AiSettingsScreen", () => {
  it("chooses a recommended model and hydrates the saved model when provider changes", async () => {
    api.getAiStatus.mockResolvedValue(status);
    api.discoverAiModels.mockImplementation(async (provider: string) => ({
      provider,
      models: provider === "GEMINI" ? geminiModels : nvidiaModels,
    }));

    render(<AiSettingsScreen />);

    const modelSelect = await screen.findByRole("combobox", { name: /Model phân tích/u });
    expect(modelSelect).toHaveValue("gemini/recommended-model");
    expect(screen.getByRole("option", { name: "Gemini cân bằng · Đề xuất" })).toBeInTheDocument();
    expect(screen.getByText("gemini/recommended-model")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /gemini\/recommended-model/u })).toBeNull();

    const keyInput = screen.getByLabelText(/Khóa API Google Gemini/u);
    fireEvent.change(keyInput, { target: { value: "draft-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "NVIDIA NIM" }));

    await waitFor(() => expect(modelSelect).toHaveValue("nvidia/saved-model"));
    expect(screen.getByLabelText(/Khóa API NVIDIA NIM/u)).toHaveValue("");
    expect(api.discoverAiModels).toHaveBeenCalledWith("GEMINI");
    expect(api.discoverAiModels).toHaveBeenCalledWith("NVIDIA");
  });

  it("keeps raw model IDs in advanced mode and saves the resolved ANALYSIS role", async () => {
    api.getAiStatus.mockResolvedValue(status);
    api.discoverAiModels.mockResolvedValue({ provider: "GEMINI", models: geminiModels });
    api.updateAiSettings.mockResolvedValue(status);

    render(<AiSettingsScreen />);

    const modelSelect = await screen.findByRole("combobox", { name: /Model phân tích/u });
    fireEvent.change(modelSelect, { target: { value: "__CUSTOM__" } });
    const customModel = screen.getByLabelText("Model ID tùy chỉnh");
    fireEvent.change(customModel, { target: { value: "custom/provider-model" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu cài đặt" }));

    await waitFor(() =>
      expect(api.updateAiSettings).toHaveBeenCalledWith({
        provider: "GEMINI",
        isEnabled: true,
        configuredModels: { ANALYSIS: "custom/provider-model" },
      }),
    );
  });
});
