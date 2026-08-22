import { describe, expect, it } from "vitest";

import { createHealthEvidence, sanitizeEvidenceText } from "./evidence.js";

describe("health evidence safety", () => {
  it("sanitizes and bounds visible text without retaining HTML", () => {
    const result = createHealthEvidence({
      evidenceCode: "UNKNOWN",
      text: "<html>\u0000  visible message  </html>",
      httpStatus: 200,
      durationMs: 123.9,
    });
    expect(result).toEqual({
      evidenceCode: "UNKNOWN",
      evidenceTextSafe: "visible message",
      httpStatus: 200,
      durationMs: 123,
    });
    expect(sanitizeEvidenceText("x".repeat(300))).toHaveLength(256);
  });
});
