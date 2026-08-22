import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
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
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/*.integration.spec.ts",
      "tests/e2e/**",
    ],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
