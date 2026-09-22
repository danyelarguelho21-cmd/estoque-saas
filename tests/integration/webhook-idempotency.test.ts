// design-principles.md: "Idempotência em escritas críticas: webhooks de pagamento processados
// com chave de idempotência (gateway_event_id único) — reprocessar o mesmo webhook não duplica
// cobrança/assinatura." Boundary-safety Pattern 5: this test checks the SIDE EFFECT (invoice
// status, subscription status), not just that the endpoint returned 200.
//
// gateway_event_id has a UNIQUE constraint on `invoices` (schemas/migrations/0001_init.sql) —
// the DB itself is the last line of defense; this test proves the application layer also
// behaves correctly (200 both times, not a 500 on the second call's unique-constraint violation).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminClient, resetTestDatabase, seedPlan } from "../fixtures/db-test-helpers";
import { signUpAndLogin, ApiClient } from "../fixtures/http-test-client";
import { makeRawChargePaidPayload } from "../fixtures/factories/pagbank-webhook.factory";

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
    const { tenantId, client } = await signUpAndLogin(planId);
    await client.post("/api/billing/subscription", { planId, paymentMethod: "pix_boleto" });

    const payload = makeRawChargePaidPayload();
    const webhookClient = new ApiClient();

    const first = await webhookClient.post("/api/webhooks/pagbank", payload, {
      "x-pagbank-signature": "test-signature-fixture",
    });
    expect(first.status).toBe(200);

    const second = await webhookClient.post("/api/webhooks/pagbank", payload, {
      "x-pagbank-signature": "test-signature-fixture",
    });
    // Replaying the identical event must still return 200 (idempotent-success), never a 500 from
    // an unhandled unique-constraint violation on gateway_event_id.
    expect(second.status).toBe(200);

    const { rows } = await db.query<{ gateway_event_id: string; status: string }>(
      `SELECT gateway_event_id, status FROM invoices WHERE tenant_id = $1 AND gateway_event_id = $2`,
      [tenantId, payload.event_id],
    );
    expect(rows.length).toBe(1); // exactly one row — no duplicate invoice/charge from the replay
    expect(rows[0]?.status).toBe("paid");
  }, 15_000);

  it("a webhook with an invalid/unverifiable signature is rejected (401) and produces no side effect", async () => {
    const { tenantId, client } = await signUpAndLogin(planId);
    await client.post("/api/billing/subscription", { planId, paymentMethod: "pix_boleto" });

    const payload = makeRawChargePaidPayload();
    const webhookClient = new ApiClient();
    const res = await webhookClient.post("/api/webhooks/pagbank", payload, {
      "x-pagbank-signature": "definitely-not-a-valid-signature",
    });

    expect(res.status).toBe(401);
    const { rows } = await db.query(`SELECT 1 FROM invoices WHERE tenant_id = $1 AND gateway_event_id = $2`, [
      tenantId,
      payload.event_id,
    ]);
    expect(rows.length).toBe(0);
  }, 15_000);

  it("a card payment declined event marks the subscription past_due without deleting/canceling it outright (grace period per BRD Open Question / AC-008)", async () => {
    const { tenantId, client } = await signUpAndLogin(planId);
    await client.post("/api/billing/subscription", { planId, paymentMethod: "card", cardToken: "tok_test_declined" });

    const failedPayload = { event_id: `evt-declined-${Date.now()}`, charge_id: "chg-declined", status: "FAILED" };
    const webhookClient = new ApiClient();
    const res = await webhookClient.post("/api/webhooks/pagbank", failedPayload, {
      "x-pagbank-signature": "test-signature-fixture",
    });
    expect(res.status).toBe(200);

    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    expect(rows[0]?.status).toBe("past_due");
  }, 15_000);
});
