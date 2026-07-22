import { defineConfig, devices } from "@playwright/test";

// E2E runs against a production build (`next start`), not `next dev`: Phaser is
// pre-bundled so the game's dynamic import mounts instantly, and there is no HMR
// module-factory churn to surface as spurious page errors. Port 3100 keeps it
// clear of a dev server on 3000. reuseExistingServer lets a pre-started prod
// server be reused for fast local iteration. The chat/game flows talk to live
// Trigger.dev + ClickHouse, so keep workers low to respect the free-plan
// Realtime connection cap.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // swiftshader gives Phaser a WebGL context in headless CI-like runs.
        launchOptions: { args: ["--use-gl=swiftshader", "--enable-webgl"] },
      },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    url: BASE_URL,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
