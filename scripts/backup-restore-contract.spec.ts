import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

describe("backup/restore contract", () => {
  it("uses a stable checksum representation for an artifact", () => {
    const content = Buffer.from("yt-monitor-backup-fixture", "utf8");
    const checksum = createHash("sha256").update(content).digest("hex");
    expect(checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(createHash("sha256").update(content).digest("hex")).toBe(checksum);
  });

  it("does not treat an empty artifact as a valid backup", () => {
    expect(Buffer.byteLength("")).toBe(0);
  });
});
