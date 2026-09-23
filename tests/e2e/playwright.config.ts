import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TEST_APP_URL = "http://127.0.0.1:3100";

function assertIsolatedTestDatabase(value: string, variableName: string): string {
  const url = new URL(value);
  const databaseName = url.pathname.replace(/^\//, "");
  if (url.protocol !== "postgresql:" || !["localhost", "127.0.0.1", "::1"].includes(url.hostname) || databaseName !== "estoque_saas_test") {
    throw new Error(
      `[e2e] REFUSING to run: ${variableName} must point to the local isolated database ` +
        `"estoque_saas_test" (tests/integration/docker-compose.test.yml); received host=${url.hostname}, database=${databaseName}.`,
    );
  }
  return value;
}

const databaseUrl = assertIsolatedTestDatabase(
  process.env.TEST_DATABASE_URL ?? "postgresql://estoque_app:devpassword@localhost:5433/estoque_saas_test",
  "TEST_DATABASE_URL",
);
const appDatabaseUrl = assertIsolatedTestDatabase(
  process.env.TEST_APP_DATABASE_URL ?? "postgresql://app_user:devpassword-app-user@localhost:5433/estoque_saas_test",
  "TEST_APP_DATABASE_URL",
);
const platformAdminDatabaseUrl = assertIsolatedTestDatabase(
  process.env.TEST_PLATFORM_ADMIN_DATABASE_URL ?? "postgresql://platform_admin_role:devpassword-platform-admin@localhost:5433/estoque_saas_test",
  "TEST_PLATFORM_ADMIN_DATABASE_URL",
);
const redisUrl = new URL(process.env.TEST_REDIS_URL ?? "redis://localhost:6380");
if (redisUrl.protocol !== "redis:" || !["localhost", "127.0.0.1", "::1"].includes(redisUrl.hostname) || redisUrl.port !== "6380") {
  throw new Error(`[e2e] REFUSING to run: TEST_REDIS_URL must point to local test Redis on port 6380; received ${redisUrl.host}.`);
}

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
// E2E is intentionally isolated from the persistent dev/prod stack. It always launches its own
// Next.js process on port 3100 with local test-only Postgres (5433) and Redis (6380). It never
// reuses an existing server or accepts an external base URL, since either could write tenants to
// a database whose identity this config cannot verify. Bring up the test dependencies and apply
// the test migrations/seeds before running the suite.
export default defineConfig({
  testDir: __dirname,
  testMatch: ["**/*.spec.ts", "**/*.e2e.ts"],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // suites share one app instance + DB; parallel workers would race on tenant/plan seed data
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["default"], ["junit", { outputFile: "tests/coverage/junit-playwright.xml" }]] : "list",
  use: {
    baseURL: TEST_APP_URL,
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
    url: TEST_APP_URL + "/api/healthz",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: databaseUrl,
      APP_DATABASE_URL: appDatabaseUrl,
      PLATFORM_ADMIN_DATABASE_URL: platformAdminDatabaseUrl,
      REDIS_URL: redisUrl.toString(),
      AUTH_SECRET: "test-secret-not-for-production-0123456789",
      AUTH_URL: TEST_APP_URL,
    },
  },
});
