// design-principles.md: "Idempotência em escritas críticas: webhooks de pagamento processados
// com chave de idempotência (gateway_event_id único) — reprocessar o mesmo webhook não duplica
// cobrança/assinatura." Boundary-safety Pattern 5: this test checks the SIDE EFFECT (invoice
// status, subscription status), not just that the endpoint returned 200.
//
// gateway_event_id has a UNIQUE constraint on `invoices` (schemas/migrations/0001_init.sql) —
// the DB itself is the last line of defense; this test proves the application layer also
// behaves correctly (200 both times, not a 500 on the second call's unique-constraint violation).
//
// REWRITTEN (Wave B, real-implementation verification — see git history for the Wave A version).
// Two genuine contract-drift bugs were found and fixed here, not application bugs:
//   1. The route (services/app/src/app/api/webhooks/pagbank/route.ts) reads the signature from
//      header `x-authenticity-token`, not `x-pagbank-signature` — the Wave A fixture used a
//      header name that was never checked by any real code, and a placeholder signature that
//      could never match the real algorithm.
//   2. `PagBankProvider.parseWebhookEvent` (libs/shared/src/payments/providers/pagbank.ts) expects
//      the actual PagBank Orders webhook shape (`{ id, charges: [{ id, status }] }`), not the
//      generic `{event_id, charge_id, status}` shape Wave A guessed before the real integration
//      existed — every webhook call failed parsing ("formato de evento não reconhecido") before
//      signature verification even mattered.
// Also: `POST /api/billing/subscription` with paymentMethod=pix_boleto does NOT create an
// invoice/charge (that is done by the `generate-monthly-charge` worker job, out of HTTP-testable
// scope here per modules/billing/subscriptions.ts's own comment) — so there is nothing for a
// webhook to match against via that flow. This suite seeds the invoice directly (admin SQL,
// exactly the shape `generate-monthly-charge` would produce), matching how
// `billing_lookup_tenant_by_gateway_ref` (schemas/migrations/0005) actually resolves a webhook's
// bare gateway_charge_id back to a tenant — the same production code path either way.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminClient, resetTestDatabase, seedPlan } from "../fixtures/db-test-helpers";
import { signUpAndLogin, ApiClient } from "../fixtures/http-test-client";
import { makeAuthenticityToken, makeRawChargeDeclinedPayload, makeRawChargePaidPayload } from "../fixtures/factories/pagbank-webhook.factory";

const WEBHOOK_SECRET = process.env.PAGBANK_WEBHOOK_SECRET ?? "dev-placeholder";

async function seedPendingInvoice(
  db: Client,
  params: { tenantId: string; subscriptionId: string; gatewayChargeId: string },
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO invoices (id, tenant_id, subscription_id, amount_cents, status, due_date, payment_method, gateway_charge_id)
     VALUES ($1, $2, $3, $4, 'pending', CURRENT_DATE, 'boleto', $5)`,
    [id, params.tenantId, params.subscriptionId, 9900, params.gatewayChargeId],
  );
  return id;
}

async function getSubscriptionId(db: Client, tenantId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [tenantId],
  );
  if (!rows[0]) throw new Error(`no subscription seeded for tenant ${tenantId}`);
  return rows[0].id;
}

describe("PagBank webhook idempotency by gateway_event_id (design-principles.md)", () => {
  let planId: string;
  let db: Client;

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
  }, 30_000);

  afterAll(async () => {
    await db?.end();
  });

  it("processing the same charge.paid event twice results in exactly one invoice row marked paid — not two, not a duplicated charge", async () => {
    const { tenantId } = await signUpAndLogin(planId);
    const subscriptionId = await getSubscriptionId(db, tenantId);
    const chargeId = `chg_${randomUUID().slice(0, 8)}`;
    await seedPendingInvoice(db, { tenantId, subscriptionId, gatewayChargeId: chargeId });

    const payload = makeRawChargePaidPayload({ chargeId });
    const rawBody = JSON.stringify(payload);
    const signature = makeAuthenticityToken(rawBody, WEBHOOK_SECRET);
    const webhookClient = new ApiClient();

    const first = await webhookClient.post("/api/webhooks/pagbank", payload, {
      "x-authenticity-token": signature,
    });
    expect(first.status).toBe(200);

    const second = await webhookClient.post("/api/webhooks/pagbank", payload, {
      "x-authenticity-token": signature,
    });
    // Replaying the identical event must still return 200 (idempotent-success), never a 500 from
    // an unhandled unique-constraint violation on gateway_event_id.
    expect(second.status).toBe(200);

    const { rows } = await db.query<{ gateway_event_id: string; status: string }>(
      `SELECT gateway_event_id, status FROM invoices WHERE tenant_id = $1 AND gateway_charge_id = $2`,
      [tenantId, chargeId],
    );
    expect(rows.length).toBe(1); // exactly one row — no duplicate invoice/charge from the replay
    expect(rows[0]?.status).toBe("paid");
    expect(rows[0]?.gateway_event_id).toBe(payload.id);
  }, 15_000);

  it("a webhook with an invalid/unverifiable signature is rejected (401) and produces no side effect", async () => {
    const { tenantId } = await signUpAndLogin(planId);
    const subscriptionId = await getSubscriptionId(db, tenantId);
    const chargeId = `chg_${randomUUID().slice(0, 8)}`;
    await seedPendingInvoice(db, { tenantId, subscriptionId, gatewayChargeId: chargeId });

    const payload = makeRawChargePaidPayload({ chargeId });
    const webhookClient = new ApiClient();
    const res = await webhookClient.post("/api/webhooks/pagbank", payload, {
      "x-authenticity-token": "definitely-not-a-valid-signature",
    });

    expect(res.status).toBe(401);
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM invoices WHERE tenant_id = $1 AND gateway_charge_id = $2`,
      [tenantId, chargeId],
    );
    expect(rows[0]?.status).toBe("pending"); // untouched — signature check runs before any mutation
  }, 15_000);

  it("a card payment declined event marks the subscription past_due without deleting/canceling it outright (grace period per BRD Open Question / AC-008)", async () => {
    const { tenantId } = await signUpAndLogin(planId);
    const subscriptionId = await getSubscriptionId(db, tenantId);
    const chargeId = `chg_${randomUUID().slice(0, 8)}`;
    await seedPendingInvoice(db, { tenantId, subscriptionId, gatewayChargeId: chargeId });

    const payload = makeRawChargeDeclinedPayload({ chargeId });
    const rawBody = JSON.stringify(payload);
    const signature = makeAuthenticityToken(rawBody, WEBHOOK_SECRET);
    const webhookClient = new ApiClient();
    const res = await webhookClient.post("/api/webhooks/pagbank", payload, {
      "x-authenticity-token": signature,
    });
    expect(res.status).toBe(200);

    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM subscriptions WHERE id = $1`,
      [subscriptionId],
    );
    expect(rows[0]?.status).toBe("past_due");
  }, 15_000);
});
