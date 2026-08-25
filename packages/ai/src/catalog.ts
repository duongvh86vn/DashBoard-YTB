import type { AIModelInfo, AIProviderId } from "./contracts.js";

const bundledAiModels = {
  GEMINI: [
    {
      id: "gemini-3.1-flash-lite",
      label: "Gemini 3.1 Flash Lite",
      description: "Nhanh, tiết kiệm và phù hợp cho các tác vụ giám sát hằng ngày.",
      recommended: true,
      source: "BUNDLED",
    },
    {
      id: "gemini-3.7-flash",
      label: "Gemini 3.7 Flash",
      description: "Mô hình Flash mới nhất cho phân tích phức tạp và nhiều bước.",
      source: "BUNDLED",
    },
    {
      id: "gemini-3.6-flash",
      label: "Gemini 3.6 Flash",
      description: "Mô hình cân bằng giữa tốc độ và chất lượng phân tích.",
      source: "BUNDLED",
    },
    {
      id: "gemini-3.5-flash-lite",
      label: "Gemini 3.5 Flash Lite",
      description: "Mô hình Flash Lite ổn định cho tác vụ có độ trễ thấp.",
      source: "BUNDLED",
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      description: "Mô hình Flash ổn định, tương thích rộng.",
      source: "BUNDLED",
    },
  ],
  NVIDIA: [
    {
      id: "deepseek-ai/deepseek-v4-flash",
      label: "DeepSeek V4 Flash",
      description: "Mặc định khuyến nghị cho phân tích nhanh qua NVIDIA NIM.",
      recommended: true,
      source: "BUNDLED",
    },
    {
      id: "openai/gpt-oss-20b",
      label: "GPT OSS 20B",
      description: "Mô hình mở gọn nhẹ cho suy luận và tạo nội dung.",
      source: "BUNDLED",
    },
    {
      id: "qwen/qwen3-next-80b-a3b-instruct",
      label: "Qwen3 Next 80B A3B Instruct",
      description: "Mô hình instruction hiệu quả cho ngữ cảnh và phân tích dài.",
      source: "BUNDLED",
    },
  ],
} as const satisfies Record<AIProviderId, readonly AIModelInfo[]>;

/** Returns a defensive copy of the curated models shown before provider discovery is available. */
export function getBundledAiModels(providerId: AIProviderId): AIModelInfo[] {
  return bundledAiModels[providerId].map((model) => ({ ...model }));
}

/** Returns the curated default for a provider, if one is configured. */
export function getRecommendedAiModel(providerId: AIProviderId): AIModelInfo | undefined {
  const model = bundledAiModels[providerId].find(
    (candidate) => "recommended" in candidate && candidate.recommended,
  );
  return model ? { ...model } : undefined;
}
