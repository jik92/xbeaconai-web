import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "line",
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: [
    {
      command:
        "API_PORT=8799 AUTH_RATE_LIMIT_MAX=1000 JWT_SECRET=playwright-e2e-secret-at-least-32-characters bun server/e2e-index.ts",
      url: "http://127.0.0.1:8799/api/health",
      reuseExistingServer: false,
    },
    {
      command: "VITE_API_PROXY_TARGET=http://127.0.0.1:8799 bun run dev -- --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } },
  ],
});
