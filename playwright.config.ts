import { defineConfig } from "@playwright/test";

// Suppress automatic DOM snapshots in failure artifacts once real records exist.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: "list",
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 25_000,
    baseURL: "http://127.0.0.1:3107",
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    locale: "ar-EG",
    timezoneId: "Africa/Cairo",
    // Auth requests contain credentials and tokens. Never retain traces/HAR/video.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3107",
    url: "http://127.0.0.1:3107/login",
    reuseExistingServer: false,
    env: { RX_UI_PREVIEW: "1" },
    timeout: 60_000,
  },
});
