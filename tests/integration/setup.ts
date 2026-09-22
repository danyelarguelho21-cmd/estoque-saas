// Global integration-suite setup. Not wired as a vitest `globalSetup` (each integration test
// file calls resetTestDatabase() itself in beforeAll) — kept as a lightweight per-file reset
// instead of a single global one so integration files stay independently runnable
// (`vitest run tests/integration/rbac.test.ts` alone must work) at the cost of a slower full
// suite. Re-evaluate as a shared globalSetup once the integration suite grows past ~15 files.

export { resetTestDatabase, adminClient, seedPlan, seedTenant, seedUser, seedStore, seedProduct } from "../fixtures/db-test-helpers";
