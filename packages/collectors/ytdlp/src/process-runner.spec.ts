import { describe, expect, it } from "vitest";

import { YtdlpError } from "./errors.js";
import { assertMetadataOnlyArgs, ConcurrencyLimiter } from "./process-runner.js";

describe("yt-dlp process safety", () => {
  it("rejects media-download flags", () => {
    expect(() => assertMetadataOnlyArgs(["--dump-single-json", "--skip-download"])).not.toThrow();
    expect(() => assertMetadataOnlyArgs(["--output", "%(title)s.mp4"])).toThrow(YtdlpError);
    expect(() => assertMetadataOnlyArgs(["--format", "best"])).toThrow(YtdlpError);
    expect(() => assertMetadataOnlyArgs(["--write-thumbnail"])).toThrow(YtdlpError);
  });

  it("bounds concurrent subprocess work", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let active = 0;
    let maximum = 0;
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        limiter.run(async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await new Promise((resolve) => setTimeout(resolve, 2 + (index % 2)));
          active -= 1;
        }),
      ),
    );
    expect(maximum).toBe(2);
    expect(active).toBe(0);
  });
});
