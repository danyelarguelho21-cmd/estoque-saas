// AC-003 (BRD) / ADR-006 §3 — "Toda saída, seja pela sugestão aceita ou por escolha manual,
// grava em stock_movements.metadata (jsonb) se a sugestão FEFO foi seguida ou sobreposta."
// This is the HTTP/DB-level companion to tests/unit/stock/fefo.test.ts (which tests the pure
// suggestion algorithm in isolation) — here we verify the override is actually persisted and
// distinguishable from an accepted suggestion, via a real sale.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminClient, resetTestDatabase, seedPlan } from "../fixtures/db-test-helpers";
import { signUpAndLogin } from "../fixtures/http-test-client";

describe("FEFO suggestion + manual override logging on sale (AC-003, ADR-006)", () => {
  let planId: string;
  let db: Client;

  beforeAll(async () => {
    await resetTestDatabase();
    const admin = adminClient();
    await admin.connect();
    try {
      planId = (await seedPlan(admin, {})).id;
    } finally {
      await admin.end();
    }
    db = adminClient();
    await db.connect();
  }, 30_000);

  afterAll(async () => {
    await db?.end();
  });

  async function setupPerishableProductWithTwoBatches(client: Awaited<ReturnType<typeof signUpAndLogin>>["client"]) {
    await client.patch("/api/tenant", { perishableTrackingEnabled: true });
    const storeRes = await client.post<{ id: string }>("/api/stores", { name: "Loja", type: "loja" });
    const productRes = await client.post<{ id: string }>("/api/products", {
      sku: "PERECIVEL-1",
      name: "Iogurte",
      unitOfMeasure: "UN",
      isPerishable: true,
    });
    const soon = await client.post("/api/stock/entries", {
      productId: productRes.body.id,
      storeId: storeRes.body.id,
      quantity: 10,
      batchNumber: "L-SOON",
      expiryDate: "2026-10-01",
    });
    const later = await client.post("/api/stock/entries", {
      productId: productRes.body.id,
      storeId: storeRes.body.id,
      quantity: 10,
      batchNumber: "L-LATER",
      expiryDate: "2026-12-01",
    });
    return { storeId: storeRes.body.id, productId: productRes.body.id, soon, later };
  }

  it("GET /api/stock/fefo-suggestion recommends the soonest-expiring batch first", async () => {
    const { client } = await signUpAndLogin(planId);
    const { storeId, productId } = await setupPerishableProductWithTwoBatches(client);

    const suggestion = await client.get<{ suggestions: { batchId: string; expiryDate: string }[]; fullyCovered: boolean }>(
      `/api/stock/fefo-suggestion?productId=${productId}&storeId=${storeId}&quantity=5`,
    );
    expect(suggestion.status).toBe(200);
    expect(suggestion.body.fullyCovered).toBe(true);
    expect(suggestion.body.suggestions[0]?.expiryDate).toBe("2026-10-01");
  }, 15_000);

  it("a sale that accepts the FEFO suggestion (omits batchId) records metadata.fefoOverridden = false", async () => {
    const { client, tenantId } = await signUpAndLogin(planId);
    const { storeId, productId } = await setupPerishableProductWithTwoBatches(client);

    const sale = await client.post("/api/sales", {
      storeId,
      items: [{ productId, quantity: 4, unitPriceCents: 500 }], // no batchId => FEFO auto-applied
    });
    expect(sale.status).toBe(201);

    const { rows } = await db.query<{ metadata: { fefoOverridden?: boolean }; batch_id: string }>(
      `SELECT metadata, batch_id FROM stock_movements WHERE tenant_id = $1 AND type = 'saida_venda'`,
      [tenantId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.metadata).toMatchObject({ fefoOverridden: false });
  }, 15_000);

  it("a sale that manually picks the LATER-expiring batch (overriding FEFO) records metadata.fefoOverridden = true", async () => {
    const { client, tenantId } = await signUpAndLogin(planId);
    const { storeId, productId } = await setupPerishableProductWithTwoBatches(client);

    const suggestion = await client.get<{ suggestions: { batchId: string }[] }>(
      `/api/stock/fefo-suggestion?productId=${productId}&storeId=${storeId}&quantity=3`,
    );
    const suggestedBatchId = suggestion.body.suggestions[0]?.batchId;

    const { rows: batchRows } = await db.query<{ id: string }>(
      `SELECT id FROM batches WHERE tenant_id = $1 AND product_id = $2 AND id != $3`,
      [tenantId, productId, suggestedBatchId],
    );
    const laterBatchId = batchRows[0]!.id;

    const sale = await client.post("/api/sales", {
      storeId,
      items: [{ productId, quantity: 3, unitPriceCents: 500, batchId: laterBatchId }],
    });
    expect(sale.status).toBe(201);

    const { rows } = await db.query<{ metadata: { fefoOverridden?: boolean }; batch_id: string }>(
      `SELECT metadata, batch_id FROM stock_movements WHERE tenant_id = $1 AND type = 'saida_venda'`,
      [tenantId],
    );
    expect(rows[0]?.batch_id).toBe(laterBatchId);
    expect(rows[0]?.metadata).toMatchObject({ fefoOverridden: true });
  }, 15_000);
});
