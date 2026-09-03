"use strict";
const path = require("path");
const { defineConfig, devices } = require("@playwright/test");
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: externalBaseURL || "http://127.0.0.1:8777",
    trace: "retain-on-failure",
    serviceWorkers: "block",
    ...devices["Desktop Chrome"],
  },
  webServer: externalBaseURL ? undefined : {
    command: "node server.js",
    url: "http://127.0.0.1:8777",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      PORT: "8777",
      RECONNECT_GRACE_MS: "4000",
      DATA_DIR: path.join(__dirname, "test-results", "account-data"),
    },
  },
});
