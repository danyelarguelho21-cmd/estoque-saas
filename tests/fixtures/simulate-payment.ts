// Shared by integration (vitest) and e2e (Playwright) specs — both are plain Node/TS test
// runners, so a plain module works for either without pulling in either framework's types here.
//
// Simulates the PagBank webhook confirming a tenant's first pix/boleto payment, for tests that
// need a genuinely ACTIVE (paid) tenant after checkout — see modules/auth/rbac.ts's
// requireSession/requireRole (BUG FIX 2026-09-28: this product has no trial period, so a tenant
// stays "pending_payment" — blocked from product access — until this actually happens).
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { makeAuthenticityToken, makeRawChargePaidPayload } from "./factories/pagbank-webhook.factory";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://estoque_app:devpassword@localhost:5433/estoque_saas_test";
const TEST_BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3100";
// Must match the webServer-scoped PAGBANK_WEBHOOK_SECRET override in
// tests/e2e/playwright.config.ts — that override only reaches the spawned app process, never this
// test-runner process itself (confirmed against .github/workflows/test.yml's e2e job env block),
// so it can't be read from process.env here and is duplicated intentionally instead.
const E2E_PAGBANK_WEBHOOK_SECRET = "e2e-webhook-secret-not-real";

/** Seeds a pending invoice for `tenantId`'s current subscription and POSTs a correctly-signed
 * charge.paid webhook confirming it — the same real code path (signature verification,
 * idempotency, subscription promotion to "active") a genuine PagBank delivery goes through. */
export async function simulateFirstPixPaymentConfirmed(tenantId: string): Promise<void> {
  const db = new Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    const subscriptionId = rows[0]?.id;
    if (!subscriptionId) throw new Error(`simulateFirstPixPaymentConfirmed: no subscription found for tenant ${tenantId}`);

    const chargeId = `chg_e2e_${randomUUID().slice(0, 8)}`;
    await db.query(
      `INSERT INTO invoices (id, tenant_id, subscription_id, amount_cents, status, due_date, payment_method, gateway_charge_id)
       VALUES ($1, $2, $3, 9900, 'pending', CURRENT_DATE, 'pix', $4)`,
      [randomUUID(), tenantId, subscriptionId, chargeId],
    );

    const payload = makeRawChargePaidPayload({ chargeId });
    const rawBody = JSON.stringify(payload);
    const signature = makeAuthenticityToken(rawBody, process.env.PAGBANK_WEBHOOK_SECRET ?? E2E_PAGBANK_WEBHOOK_SECRET);
    const res = await fetch(`${TEST_BASE_URL}/api/webhooks/pagbank`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-authenticity-token": signature },
      body: rawBody,
    });
    if (res.status !== 200) {
      throw new Error(`simulateFirstPixPaymentConfirmed: webhook POST failed with ${res.status}: ${await res.text()}`);
    }
  } finally {
    await db.end();
  }
}

/** Looks up a tenant's id by its (unique-per-test) name — the UI signup flow doesn't return the
 * tenantId to the browser/test directly. */
export async function findTenantIdByName(name: string): Promise<string> {
  const db = new Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM tenants WHERE name = $1`, [name]);
    const id = rows[0]?.id;
    if (!id) throw new Error(`findTenantIdByName: no tenant found with name ${JSON.stringify(name)}`);
    return id;
  } finally {
    await db.end();
  }
}
