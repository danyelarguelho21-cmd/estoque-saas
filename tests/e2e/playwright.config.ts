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
//
// WAVE B (real Docker stack available): default target is now the ALREADY-RUNNING
// `docker compose up -d` stack (app on :3000, migrated + role-granted Postgres on :5432) instead
// of trying to boot a second `next dev` on :3100 against a separate/never-migrated test DB —
// avoids a port collision with the app container and avoids a webServer env that was missing
// APP_DATABASE_URL/PLATFORM_ADMIN_DATABASE_URL entirely (the app would have silently fallen back
// to the admin/superuser DB connection at runtime — RLS bypassed, see libs/shared/src/db/client.ts
// — had this config's `command` ever actually been exercised). `reuseExistingServer: true`
// unconditionally: CI environments that DO want an isolated ephemeral stack should set
// TEST_BASE_URL to a real booted instance rather than relying on this config to boot one, since a
// correctly-configured boot needs the same role/grant setup `docker compose up` already performs
// (see Makefile `migrate` target) — a bare `next dev` cannot reproduce that.
export default defineConfig({
  testDir: __dirname,
  testMatch: ["**/*.spec.ts", "**/*.e2e.ts"],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // suites share one app instance + DB; parallel workers would race on tenant/plan seed data
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["default"], ["junit", { outputFile: "tests/coverage/junit-playwright.xml" }]] : "list",
  use: {
    baseURL: process.env.TEST_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev --workspace services/app -- -p 3000",
    cwd: REPO_ROOT,
    url: (process.env.TEST_BASE_URL ?? "http://localhost:3000") + "/api/healthz",
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://estoque_app:devpassword@localhost:5432/estoque_saas",
      APP_DATABASE_URL: process.env.TEST_APP_DATABASE_URL ?? "postgresql://app_user:devpassword-app-user@localhost:5432/estoque_saas",
      PLATFORM_ADMIN_DATABASE_URL: process.env.TEST_PLATFORM_ADMIN_DATABASE_URL ?? "postgresql://platform_admin_role:devpassword-platform-admin@localhost:5432/estoque_saas",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379",
      AUTH_SECRET: "test-secret-not-for-production-0123456789",
      AUTH_URL: "http://localhost:3000",
    },
  },
});
