// AC-006 (BRD) / ADR-007 — "Toda movimentação de estoque (entrada, saída, transferência, ajuste)
// gera um registro de auditoria imutável com usuário, timestamp, tipo, quantidade e saldo
// resultante." Also verifies ADR-007's atomicity claim (audit row + mutation share a transaction)
// indirectly, by checking the audit row always exists whenever the mutation does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminClient, appUserClient, resetTestDatabase, seedPlan } from "../fixtures/db-test-helpers";
import { signUpAndLogin } from "../fixtures/http-test-client";

describe("Immutable audit log on stock movements (AC-006, ADR-007)", () => {
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

  it("a manual stock entry produces exactly one audit_log row with the acting user, entity, and after-state", async () => {
    const { client, tenantId, userId } = await signUpAndLogin(planId);
    const storeRes = await client.post<{ id: string }>("/api/stores", { name: "Loja", type: "loja" });
    const productRes = await client.post<{ id: string }>("/api/products", {
      sku: "AUDIT-1",
      name: "Produto Auditado",
      unitOfMeasure: "UN",
    });

    const entryRes = await client.post<{ id: string }>("/api/stock/entries", {
      productId: productRes.body.id,
      storeId: storeRes.body.id,
      quantity: 25,
      unitCostCents: 1000,
    });
    expect(entryRes.status).toBe(201);

    const { rows } = await db.query<{ user_id: string; entity_type: string; action: string; after: Record<string, unknown> }>(
      `SELECT user_id, entity_type, action, after FROM audit_log WHERE tenant_id = $1 AND entity_type = 'stock_movement'`,
      [tenantId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.user_id).toBe(userId);
    expect(rows[0]?.action).toBe("create");
    expect(rows[0]?.after).toMatchObject({ quantity: 25 });
  }, 15_000);

  it("audit_log is append-only: the application role cannot UPDATE an existing row (enforced by DB GRANTs, not just app code)", async () => {
    const { rows: anyRow } = await db.query<{ id: string }>(`SELECT id FROM audit_log LIMIT 1`);
    if (anyRow.length === 0) return; // depends on a prior test having produced a row; DB-grant check itself lives in rls-schema-sweep.test.ts
    // FIXED (Wave B): this is an app-role-level check and MUST connect as the real `app_user`
    // role (NOBYPASSRLS, UPDATE/DELETE revoked on audit_log — schemas/migrations/0003), not the
    // admin/migration superuser connection reused here before (`adminClient()` owns every table
    // and can always UPDATE/DELETE — the assertion below could never have failed even if the real
    // app_user grant regressed). Same class of bug as rls-schema-sweep's `estoque_app` constant.
    const appClient = appUserClient();
    await appClient.connect();
    try {
      await expect(
        appClient.query(`UPDATE audit_log SET action = 'update' WHERE id = $1`, [anyRow[0]!.id]),
      ).rejects.toThrow();
    } finally {
      await appClient.end();
    }
  }, 15_000);

  it("a stock exit (perda) requires a reason and produces an audit_log row too", async () => {
    const { client, tenantId } = await signUpAndLogin(planId);
    const storeRes = await client.post<{ id: string }>("/api/stores", { name: "Loja", type: "loja" });
    const productRes = await client.post<{ id: string }>("/api/products", { sku: "AUDIT-2", name: "P2", unitOfMeasure: "UN" });
    await client.post("/api/stock/entries", { productId: productRes.body.id, storeId: storeRes.body.id, quantity: 10 });

    const missingReason = await client.post("/api/stock/exits", {
      productId: productRes.body.id,
      storeId: storeRes.body.id,
      quantity: 2,
      type: "saida_perda",
    });
    expect(missingReason.status).toBe(400);

    const withReason = await client.post("/api/stock/exits", {
      productId: productRes.body.id,
      storeId: storeRes.body.id,
      quantity: 2,
      type: "saida_perda",
      reason: "Quebra no transporte",
    });
    expect(withReason.status).toBe(201);

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::int AS count FROM audit_log WHERE tenant_id = $1 AND entity_type = 'stock_movement'`,
      [tenantId],
    );
    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(2); // entrada + saida
  }, 15_000);
});
