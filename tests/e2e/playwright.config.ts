import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TEST_APP_URL = "http://localhost:3100";

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
const testServerEnv = {
  DATABASE_URL: databaseUrl,
  APP_DATABASE_URL: appDatabaseUrl,
  PLATFORM_ADMIN_DATABASE_URL: platformAdminDatabaseUrl,
  REDIS_URL: redisUrl.toString(),
  AUTH_SECRET: "test-secret-not-for-production-0123456789",
  AUTH_URL: TEST_APP_URL,
  UPLOADS_DIR: path.join(REPO_ROOT, ".data", "e2e-uploads"),
};

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
// Next.js and BullMQ worker processes use local test-only Postgres (5433), Redis (6380), and an
// isolated upload directory. Gateway calls are pointed at a closed local port with a dummy key,
// so signup jobs cannot create real PagBank sandbox orders during unrelated browser journeys. The
// suite never reuses an existing server or accepts an external base URL. Bring up the test
// dependencies and apply test migrations/seeds before running it.
export default defineConfig({
  testDir: __dirname,
  testMatch: ["**/*.spec.ts", "**/*.e2e.ts"],
  // Bootstraps the isolated test Postgres (schema + app_user/platform_admin_role roles + one
  // seeded plan) before any webServer starts — see global-setup.ts for why this is required
  // (the vitest integration suite gets this for free via db-test-helpers.ts; Playwright specs
  // never imported it, so E2E's own Postgres was never migrated — discovered in CI run
  // 36065367454, "Authentication failed ... for `app_user`").
  globalSetup: path.join(__dirname, "global-setup.ts"),
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // suites share one app instance + DB; parallel workers would race on tenant/plan seed data
  workers: 1, // keep files sharing the isolated DB/Redis sequential even when Playwright's default is multi-worker
  retries: process.env.CI ? 2 : 0,
  // NOTE: "default" is NOT a builtin reporter name in the installed Playwright version
  // (1.63.0 — see node_modules/playwright/lib/common/index.js#builtInReporters: only
  // list/line/dot/json/junit/null/github/html/blob/perfetto are recognized now). Using
  // "default" made resolveReporters() fall through to require.resolve("default"), which
  // always throws MODULE_NOT_FOUND and failed the entire E2E job before a single test ran
  // (discovered on the first real CI run, commit 88df6d6). "list" matches the local
  // (non-CI) reporter below for identical human-readable output in both environments.
  reporter: process.env.CI ? [["list"], ["junit", { outputFile: "tests/coverage/junit-playwright.xml" }]] : "list",
  use: {
    baseURL: TEST_APP_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "npm run dev --workspace services/app -- -p 3100",
      cwd: REPO_ROOT,
      url: TEST_APP_URL + "/api/healthz",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...testServerEnv,
        PAGBANK_API_KEY: "e2e-no-gateway-key",
        PAGBANK_BASE_URL: "http://127.0.0.1:1",
        PAGBANK_WEBHOOK_SECRET: "e2e-webhook-secret-not-real",
        RATE_LIMIT_SIGNUP_IP_MAX: "100",
        RATE_LIMIT_LOGIN_IP_MAX: "100",
      },
    },
    {
      command: "npm run worker --workspace services/app",
      cwd: REPO_ROOT,
      wait: { stdout: /\[worker\] escutando fila: generate-monthly-charge/ },
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...testServerEnv,
        PAGBANK_API_KEY: "e2e-no-gateway-key",
        PAGBANK_BASE_URL: "http://127.0.0.1:1",
        PAGBANK_WEBHOOK_SECRET: "e2e-webhook-secret-not-real",
        RATE_LIMIT_SIGNUP_IP_MAX: "100",
        RATE_LIMIT_LOGIN_IP_MAX: "100",
      },
    },
  ],
});
