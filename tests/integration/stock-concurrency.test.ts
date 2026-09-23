// Closes code-reviewer finding CR-1 (Wave B, critical.md): getCurrentStock()/nextBalanceAfter()
// derive the balance via a plain SELECT with no row lock and no non-default isolation level, so
// two concurrent writers against the same (product, store) could both read the same "current"
// balance and both commit — a lost update — and resolveExitLines' sufficiency check had the same
// TOCTOU, allowing an oversell. The fix is lockStockRow() (services/app/src/modules/stock/balance.ts),
// a pg_advisory_xact_lock keyed on (tenant, product, store) acquired as the first statement of
// every stock-mutating transaction. These tests fire real concurrent requests (Promise.all, not
// sequential awaits) — the loop-protocol point CR-1 itself makes: a sequential test would never
// exercise the interleaving that causes the bug.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
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

async function setupTenantWithStock(
  planId: string,
  initialQuantity: number,
): Promise<{ client: ApiClient; tenantId: string; productId: string; storeId: string }> {
  const { client, tenantId } = await signUpAndLogin(planId);
  const storeRes = await client.post<{ id: string }>("/api/stores", { name: "Loja Concorrência", type: "loja" });
  const storeId = storeRes.body.id;

  const productRes = await client.post<{ id: string }>("/api/products", {
    sku: `CONC-${Math.random().toString(36).slice(2, 8)}`,
    name: "Produto Concorrente",
    unitOfMeasure: "UN",
  });
  const productId = productRes.body.id;

  if (initialQuantity > 0) {
    const entryRes = await client.post("/api/stock/entries", { productId, storeId, quantity: initialQuantity });
    expect(entryRes.status).toBe(201);
  }

  return { client, tenantId, productId, storeId };
}

describe("Stock balance under real concurrency (createStockExit/createManualEntry, CR-1)", () => {
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

  it("two concurrent exits whose combined demand exceeds available stock: exactly one succeeds, balance reflects exactly one decrement", async () => {
    const { client, tenantId, productId, storeId } = await setupTenantWithStock(planId, 10);

    // Combined demand (6 + 6 = 12) exceeds the 10 available — under the pre-fix read-then-write
    // race, both requests could read "10 available", both pass the `< quantity` check, and both
    // commit (oversell). Fired via Promise.all, not sequential awaits, to actually interleave.
    const [resA, resB] = await Promise.all([
      client.post("/api/stock/exits", { productId, storeId, quantity: 6, type: "ajuste" }),
      client.post("/api/stock/exits", { productId, storeId, quantity: 6, type: "ajuste" }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]); // exactly one succeeds, the other is rejected as insufficient stock

    // The balance must reflect exactly the ONE successful decrement (10 - 6 = 4), never 10 (both
    // rejected), never -2 (both accepted / oversold), and never a value that "lost" one write.
    expect(await currentBalance(db, tenantId, productId, storeId)).toBe(4);
  });

  it("two concurrent exits whose combined demand exactly fits available stock: both succeed, balance reflects both decrements", async () => {
    const { client, tenantId, productId, storeId } = await setupTenantWithStock(planId, 10);

    const [resA, resB] = await Promise.all([
      client.post("/api/stock/exits", { productId, storeId, quantity: 4, type: "ajuste" }),
      client.post("/api/stock/exits", { productId, storeId, quantity: 6, type: "ajuste" }),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    // Under the pre-fix race, both could read balance=10 and each independently compute
    // balance_after=6 and balance_after=4 — a lost update where the later commit "wins" and the
    // other decrement vanishes from the derived balance. The correct final balance is 0 (both
    // decrements applied), not 6 and not 4.
    expect(await currentBalance(db, tenantId, productId, storeId)).toBe(0);
  });

  it("two concurrent manual entries on the same product/store: both credits land, no lost update", async () => {
    const { client, tenantId, productId, storeId } = await setupTenantWithStock(planId, 0);

    const [resA, resB] = await Promise.all([
      client.post("/api/stock/entries", { productId, storeId, quantity: 15 }),
      client.post("/api/stock/entries", { productId, storeId, quantity: 25 }),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(await currentBalance(db, tenantId, productId, storeId)).toBe(40); // 15 + 25, neither lost
  });
});
