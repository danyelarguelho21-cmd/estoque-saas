// P1 gap closed in Wave B (test-plan.md risk register: "stock | POST /api/transfers | — | P1 |
// Gap — no scaffold yet"). Orchestrator brief explicitly names "transfers atomicity" as a
// priority now that the real implementation exists (services/app/src/modules/stock/transfers.ts).
//
// The load-bearing guarantee under test: `createTransfer()` debits the origin store and credits
// the destination store for EVERY item inside a single Prisma transaction (`withTenant()` opens
// one transaction for the whole function) — if ANY item fails (e.g. insufficient stock on a later
// item), NOTHING must be persisted, not even the earlier items that would have succeeded on their
// own. A test that only checks the final 409 without checking stock_movements/balances would miss
// exactly the bug this guarantee exists to prevent (a half-applied transfer).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminClient, resetTestDatabase, seedPlan } from "../fixtures/db-test-helpers";
import { signUpAndLogin, type ApiClient } from "../fixtures/http-test-client";

async function currentBalance(db: Client, tenantId: string, productId: string, storeId: string): Promise<number> {
  const { rows } = await db.query<{ balance: string | null }>(
    `SELECT sum(quantity)::int AS balance FROM stock_movements WHERE tenant_id = $1 AND product_id = $2 AND store_id = $3`,
    [tenantId, productId, storeId],
  );
  return Number(rows[0]?.balance ?? 0);
}

async function movementCount(db: Client, tenantId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(`SELECT count(*)::int AS count FROM stock_movements WHERE tenant_id = $1`, [tenantId]);
  return Number(rows[0]?.count ?? 0);
}

async function setupTenantWithTwoStoresAndStock(
  planId: string,
  initialQuantity: number,
): Promise<{ client: ApiClient; tenantId: string; productId: string; originStoreId: string; destinationStoreId: string }> {
  const { client, tenantId } = await signUpAndLogin(planId);
  const originRes = await client.post<{ id: string }>("/api/stores", { name: "Loja Origem", type: "loja" });
  const destRes = await client.post<{ id: string }>("/api/stores", { name: "Loja Destino", type: "deposito" });
  const originStoreId = originRes.body.id;
  const destinationStoreId = destRes.body.id;

  const productRes = await client.post<{ id: string }>("/api/products", {
    sku: `TRANSFER-${Math.random().toString(36).slice(2, 8)}`,
    name: "Produto Transferível",
    unitOfMeasure: "UN",
  });
  const productId = productRes.body.id;

  // quantity must be >= 1 per ManualEntrySchema (services/app/src/app/api/stock/entries/route.ts)
  // — callers that only need the stores/product (not the initial-stock entry, e.g. the perishable
  // batch test which seeds its own entry with a batch number) pass 0 to skip this step entirely.
  if (initialQuantity > 0) {
    const entryRes = await client.post("/api/stock/entries", { productId, storeId: originStoreId, quantity: initialQuantity });
    expect(entryRes.status).toBe(201);
  }

  return { client, tenantId, productId, originStoreId, destinationStoreId };
}

describe("Stock transfers between stores (createTransfer, ADR — atomicity)", () => {
  let planId: string;
  let db: Client;

  beforeAll(async () => {
    await resetTestDatabase();
    const admin = adminClient();
    await admin.connect();
    try {
      const plan = await seedPlan(admin, { maxStores: 10 });
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

  it("a valid transfer debits the origin and credits the destination for the exact quantity, in one atomic operation", async () => {
    const { client, tenantId, productId, originStoreId, destinationStoreId } = await setupTenantWithTwoStoresAndStock(planId, 20);

    const res = await client.post<{ transferId: string }>("/api/transfers", {
      originStoreId,
      destinationStoreId,
      items: [{ productId, quantity: 8 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.transferId).toBeTruthy();

    expect(await currentBalance(db, tenantId, productId, originStoreId)).toBe(12); // 20 - 8
    expect(await currentBalance(db, tenantId, productId, destinationStoreId)).toBe(8);

    const { rows } = await db.query<{ type: string; quantity: number }>(
      `SELECT type, quantity FROM stock_movements WHERE tenant_id = $1 AND reference_id = $2 ORDER BY created_at`,
      [tenantId, res.body.transferId],
    );
    expect(rows).toEqual([
      expect.objectContaining({ type: "transferencia_saida", quantity: -8 }),
      expect.objectContaining({ type: "transferencia_entrada", quantity: 8 }),
    ]);
  });

  it("requesting more than the origin's available stock is rejected (409) and creates ZERO stock_movements — no partial transfer", async () => {
    const { client, tenantId, productId, originStoreId, destinationStoreId } = await setupTenantWithTwoStoresAndStock(planId, 5);
    const before = await movementCount(db, tenantId);

    const res = await client.post("/api/transfers", {
      originStoreId,
      destinationStoreId,
      items: [{ productId, quantity: 999 }],
    });
    expect(res.status).toBe(409);

    expect(await movementCount(db, tenantId)).toBe(before); // nothing persisted
    expect(await currentBalance(db, tenantId, productId, originStoreId)).toBe(5); // untouched
    expect(await currentBalance(db, tenantId, productId, destinationStoreId)).toBe(0);
  });

  it("ATOMICITY: a multi-item transfer where the SECOND item has insufficient stock rolls back the FIRST item too — nothing half-applied", async () => {
    const { client, tenantId, productId, originStoreId, destinationStoreId } = await setupTenantWithTwoStoresAndStock(planId, 10);

    // A second product with almost no stock — item #2 in the transfer will fail.
    const shortProductRes = await client.post<{ id: string }>("/api/products", {
      sku: `SHORT-${Math.random().toString(36).slice(2, 8)}`,
      name: "Produto com Pouco Estoque",
      unitOfMeasure: "UN",
    });
    const shortProductId = shortProductRes.body.id;
    await client.post("/api/stock/entries", { productId: shortProductId, storeId: originStoreId, quantity: 1 });

    const before = await movementCount(db, tenantId);

    const res = await client.post("/api/transfers", {
      originStoreId,
      destinationStoreId,
      items: [
        { productId, quantity: 6 }, // would succeed on its own (10 available)
        { productId: shortProductId, quantity: 50 }, // fails (only 1 available) — must roll back item #1 too
      ],
    });
    expect(res.status).toBe(409);

    // The critical atomicity assertion: item #1's movements must NOT exist despite being
    // individually valid — the whole transfer is one transaction (loop-protocol: this is exactly
    // the bug class a per-item-only test would miss).
    expect(await movementCount(db, tenantId)).toBe(before);
    expect(await currentBalance(db, tenantId, productId, originStoreId)).toBe(10); // untouched, not 4
    expect(await currentBalance(db, tenantId, productId, destinationStoreId)).toBe(0);
    expect(await currentBalance(db, tenantId, shortProductId, originStoreId)).toBe(1); // untouched
  });

  it("same origin and destination store is rejected (400) before any stock movement", async () => {
    const { client, tenantId, productId, originStoreId } = await setupTenantWithTwoStoresAndStock(planId, 10);
    const before = await movementCount(db, tenantId);

    const res = await client.post("/api/transfers", {
      originStoreId,
      destinationStoreId: originStoreId,
      items: [{ productId, quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect(await movementCount(db, tenantId)).toBe(before);
  });

  it("an empty items array is rejected (400)", async () => {
    const { client, originStoreId, destinationStoreId } = await setupTenantWithTwoStoresAndStock(planId, 10);
    const res = await client.post("/api/transfers", { originStoreId, destinationStoreId, items: [] });
    expect(res.status).toBe(400);
  });

  it("a transfer moving a perishable product's batch decrements the origin batch and creates/credits the matching batch at the destination", async () => {
    const { client, tenantId, originStoreId, destinationStoreId } = await setupTenantWithTwoStoresAndStock(planId, 0);

    const perishableRes = await client.post<{ id: string }>("/api/products", {
      sku: `PERECIVEL-${Math.random().toString(36).slice(2, 8)}`,
      name: "Produto Perecível",
      unitOfMeasure: "UN",
      isPerishable: true,
    });
    const perishableProductId = perishableRes.body.id;

    const entryRes = await client.post<{ id: string }>("/api/stock/entries", {
      productId: perishableProductId,
      storeId: originStoreId,
      quantity: 12,
      batchNumber: "L-TRANSFER-1",
      expiryDate: "2027-01-01",
    });
    expect(entryRes.status).toBe(201);

    const { rows: originBatchRows } = await db.query<{ id: string; quantity: number }>(
      `SELECT id, quantity FROM batches WHERE tenant_id = $1 AND product_id = $2 AND store_id = $3`,
      [tenantId, perishableProductId, originStoreId],
    );
    expect(originBatchRows).toHaveLength(1);
    const originBatchId = originBatchRows[0]!.id;

    const res = await client.post<{ transferId: string }>("/api/transfers", {
      originStoreId,
      destinationStoreId,
      items: [{ productId: perishableProductId, batchId: originBatchId, quantity: 5 }],
    });
    expect(res.status).toBe(201);

    const { rows: batchesAfter } = await db.query<{ store_id: string; quantity: number; batch_number: string }>(
      `SELECT store_id, quantity, batch_number FROM batches WHERE tenant_id = $1 AND product_id = $2 ORDER BY store_id`,
      [tenantId, perishableProductId],
    );
    const originBatch = batchesAfter.find((b) => b.store_id === originStoreId);
    const destinationBatch = batchesAfter.find((b) => b.store_id === destinationStoreId);
    expect(originBatch?.quantity).toBe(7); // 12 - 5
    expect(destinationBatch?.quantity).toBe(5);
    expect(destinationBatch?.batch_number).toBe("L-TRANSFER-1"); // same batch identity moved, per transfers.ts comment
  });
});
