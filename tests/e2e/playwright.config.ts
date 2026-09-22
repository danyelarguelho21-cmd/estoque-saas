import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// QA-owned Playwright config (loop-protocol Rule 4 — tests/ and its runner config are the
// oracle of record; engineers build against it, never weaken it).
//
// Run:
//   docker compose -f tests/integration/docker-compose.test.yml up -d
//   npx playwright test --config tests/e2e/playwright.config.ts
//
// `webServer` boots the real Next.js app (services/app) against the test Postgres/Redis
// containers so `ui/flows/*.spec.ts` exercise the actual full stack, not a mock — required for
// boundary-safety Pattern 5 (full user journeys, not just individual endpoint responses).
export default defineConfig({
  testDir: __dirname,
  testMatch: ["**/*.spec.ts", "**/*.e2e.ts"],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // suites share one app instance + DB; parallel workers would race on tenant/plan seed data
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["default"], ["junit", { outputFile: "tests/coverage/junit-playwright.xml" }]] : "list",
  use: {
    baseURL: process.env.TEST_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev --workspace services/app -- -p 3100",
    cwd: REPO_ROOT,
    url: "http://localhost:3100/api/healthz",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://estoque_app:devpassword@localhost:5433/estoque_saas_test",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6380",
      AUTH_SECRET: "test-secret-not-for-production-0123456789",
      AUTH_URL: "http://localhost:3100",
    },
  },
});
