// Playwright globalSetup — runs ONCE, before any webServer starts and before any test file.
//
// ROOT CAUSE this closes (found running E2E for the first time in real CI, run 36065367454):
// the vitest integration suite bootstraps its own Postgres schema + app_user/platform_admin_role
// roles via resetTestDatabase() (tests/fixtures/db-test-helpers.ts), called from every integration
// test file's beforeAll — see that function's own doc comment for the full history. The E2E suite
// never imports db-test-helpers.ts (Playwright specs drive the real browser/UI, not raw SQL), so
// its Postgres service container — otherwise identical to the integration job's — was NEVER
// migrated: the app's own Next.js dev server (started by playwright.config.ts's `webServer`)
// connects as `app_user` (libs/shared/src/db/client.ts), a role that only schemas/migrations/0003
// creates, and every request failed with "Authentication failed ... for `app_user`" (which
// Postgres also returns when the role plain doesn't exist — see resetTestDatabase()'s own comment
// on that exact confusion).
//
// Reusing resetTestDatabase() here (rather than duplicating its migration-chain/lock logic) keeps
// there being exactly one place that knows how to bootstrap the isolated test database. It is a
// no-op fast path if some future change makes the integration job share this container (it never
// currently does — each CI job gets its own fresh service containers).
//
// Also seeds one plan: every E2E signup flows through the real /cadastro UI (see
// tests/e2e/ui/pages/signup.page.ts#selectPlan), which lists plans fetched from the actual
// /api/plans endpoint — unlike the HTTP-integration suite, there is no signUpAndLogin(planId) to
// hand a test-created plan id to, so at least one plan row must already exist for the plan-card
// step to have anything to click.
import { resetTestDatabase, adminClient, seedPlan } from "../fixtures/db-test-helpers";

export default async function globalSetup(): Promise<void> {
  await resetTestDatabase();
  const client = adminClient();
  await client.connect();
  try {
    await seedPlan(client);
  } finally {
    await client.end();
  }
}
