"use strict";
const { defineConfig, devices } = require("@playwright/test");
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const remoteRun = externalBaseURL && !process.env.PLAYWRIGHT_LOCAL_RUN;

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: remoteRun ? 90_000 : 30_000,
  expect: { timeout: remoteRun ? 45_000 : 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: externalBaseURL || "http://127.0.0.1:8777",
    trace: "retain-on-failure",
    serviceWorkers: "block",
    ...devices["Desktop Chrome"],
  },
});
