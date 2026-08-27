import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const startFastScript = readFileSync(new URL("./start-fast.ps1", import.meta.url), "utf8");
const startLocalScript = readFileSync(new URL("./start-local.ps1", import.meta.url), "utf8");
const publishWorkflow = readFileSync(
  new URL("../.github/workflows/publish-containers.yml", import.meta.url),
  "utf8",
);

describe("fast Docker startup contract", () => {
  it("recreates containers after pulling a new immutable image set", () => {
    expect(startFastScript).toMatch(/\$startupArguments\s*=\s*@\(/u);
    expect(startFastScript).toMatch(
      /if \(\$mustPull\)[\s\S]*?\$startupArguments \+= '--force-recreate'/u,
    );
    expect(startFastScript).toContain("& docker @startupArguments");
  });

  it("recreates a partially installed stack when full setup uses prebuilt images", () => {
    expect(startLocalScript).toMatch(/\$finalUpArguments\s*=\s*@\(/u);
    expect(startLocalScript).toMatch(
      /if \(\$UsePrebuilt\)[\s\S]*?\$finalUpArguments \+= '--force-recreate'/u,
    );
    expect(startLocalScript).toContain("Invoke-Compose @finalUpArguments");
  });

  it("checks the auth runtime export inside the published API image", () => {
    expect(publishWorkflow).toContain("Verify API runtime exports");
    expect(publishWorkflow).toContain('typeof auth.assertPasswordPolicy !== "function"');
  });
});
