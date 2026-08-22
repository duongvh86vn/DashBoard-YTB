import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  outputDir: "/tmp/yhm-playwright-output",
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
