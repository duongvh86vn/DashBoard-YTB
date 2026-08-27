import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@yt-monitor/shared/browser-auth": fileURLToPath(
        new URL("./packages/shared/src/browser-auth.ts", import.meta.url),
      ),
      "@yt-monitor/auth": fileURLToPath(new URL("./packages/auth/src/index.ts", import.meta.url)),
      "@yt-monitor/analytics": fileURLToPath(
        new URL("./packages/analytics/src/index.ts", import.meta.url),
      ),
      "@yt-monitor/config": fileURLToPath(
        new URL("./packages/config/src/index.ts", import.meta.url),
      ),
      "@yt-monitor/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
      "@yt-monitor/collector-ytdlp": fileURLToPath(
        new URL("./packages/collectors/ytdlp/src/index.ts", import.meta.url),
      ),
      "@yt-monitor/collector-youtube-public": fileURLToPath(
        new URL("./packages/collectors/youtube-public/src/index.ts", import.meta.url),
      ),
      "@yt-monitor/collector-youtube-rss": fileURLToPath(
        new URL("./packages/collectors/youtube-rss/src/index.ts", import.meta.url),
      ),
      "@yt-monitor/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["apps/**/*.integration.spec.ts", "packages/**/*.integration.spec.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.worktrees/**",
      "tests/e2e/**",
    ],
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    restoreMocks: true,
  },
});
