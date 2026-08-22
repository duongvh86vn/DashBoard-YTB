import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@yt-monitor/shared/browser-auth": fileURLToPath(
        new URL("./packages/shared/src/browser-auth.ts", import.meta.url),
      ),
      "@yt-monitor/auth": fileURLToPath(new URL("./packages/auth/src/index.ts", import.meta.url)),
      "@yt-monitor/config": fileURLToPath(
        new URL("./packages/config/src/index.ts", import.meta.url),
      ),
      "@yt-monitor/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
      "@yt-monitor/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.integration.spec.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    restoreMocks: true,
  },
});
