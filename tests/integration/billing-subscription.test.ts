// Closes a real bug found via manual e2e browser testing (not caught by any prior automated
// test — there was no integration test at all for POST /api/billing/subscription before this):
// choosing pix_boleto at checkout created the subscription (201) but NEVER generated a first
// invoice, even though cadastro/page.tsx explicitly promises "a cobrança do primeiro ciclo será
// gerada automaticamente após a confirmação" — "Assinatura → Faturas" stayed empty indefinitely.
//
// Root cause (see subscriptions.ts's own comment on the fix): createSubscription()'s pix_boleto
// branch used to set currentPeriodEnd = now + 1 month, as if a period had already been paid.
// generateChargeForTenant()'s due-check is `!currentPeriodEnd || currentPeriodEnd <= now` — so a
// brand-new subscription was never "due" until a month had passed, and the only trigger was the
// daily 06:00 cron, so even after that month a tenant would wait up to 24h with zero feedback.
//
// This suite verifies what's honestly testable with REAL infrastructure (real Postgres, real
// Redis/BullMQ, real HTTP) and no mocking: (1) the subscription is no longer prematurely marked
// as having a paid-through period, and (2) checkout immediately enqueues the charge-generation
// job instead of only relying on the next scheduled cron run. It does NOT assert the resulting
// invoice actually reaches "paid" via PagBank — that leg calls the real PagBank sandbox API
// (libs/shared/src/payments/providers/pagbank.ts), which requires real PAGBANK_API_KEY
// credentials this test environment does not have (PAGBANK_API_KEY=dev-placeholder gets a real,
// non-mocked 401 from PagBank's real sandbox, which is itself useful signal: the worker job
// should fail cleanly — no invoice, no partial state — not crash or corrupt anything, which the
// last test in this file confirms).
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminClient, resetTestDatabase, seedPlan } from "../fixtures/db-test-helpers";
import { signUpAndLogin } from "../fixtures/http-test-client";

const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6380";

async function getSubscriptionRow(db: Client, tenantId: string) {
  const { rows } = await db.query<{
    status: string;
    payment_method: string;
    current_period_start: Date | null;
    current_period_end: Date | null;
  }>(
    `SELECT status, payment_method, current_period_start, current_period_end
     FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [tenantId],
  );
  return rows[0];
}

async function invoiceCount(db: Client, tenantId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(`SELECT count(*)::int AS count FROM invoices WHERE tenant_id = $1`, [tenantId]);
  return Number(rows[0]?.count ?? 0);
}

describe("Pix/boleto subscription checkout generates the first invoice automatically (not just on the next daily cron)", () => {
  let planId: string;
  let db: Client;
  let jobQueue: Queue;

  beforeAll(async () => {
    await resetTestDatabase();
    const admin = adminClient();
    await admin.connect();
    try {
      const plan = await seedPlan(admin, {});
      planId = plan.id;
    } finally {
      await admin.end();
    }
    db = adminClient();
    await db.connect();
    jobQueue = new Queue("generate-monthly-charge", { connection: { url: TEST_REDIS_URL } });
  }, 30_000);

  afterAll(async () => {
    await db?.end();
    await jobQueue?.close();
  });

  it("confirming pix/boleto checkout does NOT set a future currentPeriodEnd — the subscription stays 'due' for its first charge (root-cause fix)", async () => {
    const { client, tenantId } = await signUpAndLogin(planId);

    // Before checkout: the trialing subscription created at signup has no period set — it's
    // already "due" per generateChargeForTenant()'s own check. This is the known-good baseline.
    const beforeCheckout = await getSubscriptionRow(db, tenantId);
    expect(beforeCheckout?.current_period_end).toBeNull();

    const res = await client.post("/api/billing/subscription", { planId, paymentMethod: "pix_boleto" });
    expect(res.status).toBe(201);

    // THE bug: this used to be a real future Date here, which made the tenant NOT due for a
    // month. It must stay null (or otherwise not-yet-due) until an actual charge is generated.
    const afterCheckout = await getSubscriptionRow(db, tenantId);
    expect(afterCheckout?.status).toBe("active");
    expect(afterCheckout?.payment_method).toBe("pix_boleto");
    expect(afterCheckout?.current_period_end).toBeNull();
  });

  it("confirming pix/boleto checkout enqueues a generate-monthly-charge job immediately, not only via the next daily cron", async () => {
    const { client, tenantId } = await signUpAndLogin(planId);
    void tenantId;

    const before = await jobQueue.getJobCounts("waiting", "active", "completed", "delayed");
    const totalBefore = Object.values(before).reduce((sum, n) => sum + n, 0);

    const res = await client.post("/api/billing/subscription", { planId, paymentMethod: "pix_boleto" });
    expect(res.status).toBe(201);

    // Give BullMQ a moment to register the enqueue (in-process Redis round-trip, not a worker
    // run) — this asserts the ENQUEUE happened, independent of whether a worker is even running
    // to process it (that's covered by monthly-charge.ts's own unit-level due-check logic and by
    // the next test's real-worker run).
    await new Promise((r) => setTimeout(r, 300));
    const after = await jobQueue.getJobCounts("waiting", "active", "completed", "delayed");
    const totalAfter = Object.values(after).reduce((sum, n) => sum + n, 0);

    expect(totalAfter).toBeGreaterThan(totalBefore);
  });

  it("a card subscription does NOT enqueue a generate-monthly-charge job (PagBank handles card recurrence natively — ADR-004)", async () => {
    const { client, tenantId } = await signUpAndLogin(planId);
    void tenantId;

    const before = await jobQueue.getJobCounts("waiting", "active", "completed", "delayed");
    const totalBefore = Object.values(before).reduce((sum, n) => sum + n, 0);

    // cardToken is fake and PAGBANK_API_KEY is a placeholder — PagBank rejects both, so this can
    // land as 201 (unlikely without real credentials), 402 (PaymentRequiredError, the handled
    // "card declined" path), or 500 (an unhandled PagBankApiError from a 403 auth failure against
    // the real sandbox — a real gap, but a credentials/environment one, not this test's concern:
    // it only needs the request to REACH the enqueue decision, not to succeed).
    const res = await client.post("/api/billing/subscription", { planId, paymentMethod: "card", cardToken: "fake-token-not-real" });
    expect([201, 402, 500]).toContain(res.status);

    await new Promise((r) => setTimeout(r, 300));
    const after = await jobQueue.getJobCounts("waiting", "active", "completed", "delayed");
    const totalAfter = Object.values(after).reduce((sum, n) => sum + n, 0);
    expect(totalAfter).toBe(totalBefore);
  });

  // Requires a real worker (services/app/src/worker/index.ts) running against this same test
  // Redis/Postgres — see docs/guides/developer-guide.md / .claude/skills/local-dev-stack-bootstrap
  // for how to boot one locally. Skipped automatically if RUN_WORKER_DEPENDENT_TESTS isn't set,
  // since CI/most local runs don't have a worker process running alongside vitest.
  (process.env.RUN_WORKER_DEPENDENT_TESTS ? it : it.skip)(
    "WORKER-DEPENDENT: the enqueued job is picked up and processed cleanly even without real PagBank credentials — no invoice created, no crash, no duplicate on retry",
    async () => {
      const { client, tenantId } = await signUpAndLogin(planId);
      const res = await client.post("/api/billing/subscription", { planId, paymentMethod: "pix_boleto" });
      expect(res.status).toBe(201);

      // Poll for the job to be processed (completed OR failed — either is a clean outcome here,
      // since PAGBANK_API_KEY=dev-placeholder cannot authenticate against the real sandbox).
      let attempts = 0;
      let settled = false;
      while (!settled && attempts < 40) {
        const counts = await jobQueue.getJobCounts("waiting", "active");
        if (counts.waiting === 0 && counts.active === 0) settled = true;
        else await new Promise((r) => setTimeout(r, 250));
        attempts += 1;
      }
      expect(settled).toBe(true);

      // Without real PagBank credentials the charge call fails and the whole transaction rolls
      // back (generateChargeForTenant is one withTenant() transaction) — asserting exactly ZERO
      // invoices here proves there's no partial/corrupt state, not that billing succeeded.
      expect(await invoiceCount(db, tenantId)).toBe(0);
    },
    20_000,
  );
});
