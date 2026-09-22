// AC-010 (BRD) / ADR-002 — CRITICAL cross-cutting guarantee.
//
// "Dado dois tenants distintos, nenhuma consulta deve retornar registros de outro tenant —
//  isolamento reforçado em nível de banco (Row-Level Security), não apenas filtro de aplicação."
//
// This test deliberately exercises the DB/RLS layer directly via withTenant() from
// @estoque-saas/shared, INCLUDING queries that omit a WHERE tenant_id clause — simulating the
// exact application bug ADR-002 says RLS must survive. It does NOT go through HTTP, so it stays
// green/red independent of whether any Route Handler exists yet (unlike the HTTP-level suites,
// this one only needs the Prisma package + a real Postgres to be meaningful).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resetTestDatabase, adminClient, seedPlan, seedTenant, seedUser, seedStore, seedProduct } from "../fixtures/db-test-helpers";

// withTenant() is the shared RLS-context helper (ADR-002 §3) — implemented, not a stub, in
// libs/shared/src/db/client.ts. It depends on `DATABASE_URL` pointing at the SAME database as
// TEST_DATABASE_URL for this suite to be meaningful; set both to the test Postgres instance.
import { withTenant } from "@estoque-saas/shared";

describe("Multi-tenant isolation via Postgres RLS (AC-010, ADR-002)", () => {
  let admin: Client;
  let planId: string;
  let tenantA: { id: string };
  let tenantB: { id: string };
  let productA: string;
  let productB: string;

  beforeAll(async () => {
    await resetTestDatabase();
    admin = adminClient();
    await admin.connect();
    const plan = await seedPlan(admin, { maxProducts: 999, maxUsers: 999, maxStores: 999 });
    planId = plan.id;
    tenantA = await seedTenant(admin, planId, { name: "Tenant A" });
    tenantB = await seedTenant(admin, planId, { name: "Tenant B" });
    productA = await seedProduct(admin, tenantA.id, { sku: "SKU-A", name: "Produto do Tenant A" });
    productB = await seedProduct(admin, tenantB.id, { sku: "SKU-B", name: "Produto do Tenant B" });
  }, 30_000);

  afterAll(async () => {
    await admin?.end();
  });

  it("a tenant-scoped SELECT with NO WHERE tenant_id clause still only returns rows for the active tenant context (fail-safe against app bugs)", async () => {
    const rowsSeenByA = await withTenant(tenantA.id, async (tx) => {
      // Deliberately the "buggy" query an engineer might write — no WHERE at all.
      return tx.$queryRawUnsafe<{ id: string; tenant_id: string }[]>(`SELECT id, tenant_id FROM products`);
    });

    expect(rowsSeenByA.length).toBe(1);
    expect(rowsSeenByA[0]?.id).toBe(productA);
    expect(rowsSeenByA.some((r) => r.id === productB)).toBe(false);
  });

  it("tenant B's context never sees tenant A's rows, symmetrically", async () => {
    const rowsSeenByB = await withTenant(tenantB.id, async (tx) => {
      return tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM products`);
    });
    expect(rowsSeenByB.map((r) => r.id)).toEqual([productB]);
  });

  it("a SELECT with no tenant context set at all (app.tenant_id unset) returns ZERO rows — fails closed, not open", async () => {
    const client = adminClient();
    await client.connect();
    try {
      // No set_config('app.tenant_id', ...) call at all — mimics a request path that forgot to
      // call withTenant(). current_setting(..., true) returns NULL when unset, and
      // `tenant_id = NULL` is never true in SQL, so RLS must return zero rows (ADR-002 §"fail-safe").
      const { rows } = await client.query(`SELECT id FROM products`);
      expect(rows).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("an INSERT attempting to write a row under a different tenant_id than the active RLS context is rejected", async () => {
    // The migration's tenant_isolation policy is created without a `FOR` clause (defaults to ALL
    // commands) and without an explicit WITH CHECK — per Postgres semantics that makes USING do
    // double duty as the CHECK for INSERT/UPDATE too. This test pins that behavior down: if a
    // future migration change narrows the policy to `FOR SELECT` only, or adds a permissive
    // WITH CHECK, this test must start failing loudly.
    await expect(
      withTenant(tenantA.id, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO products (tenant_id, sku, name, unit_of_measure) VALUES ($1, 'SKU-CROSS', 'Cross-tenant insert attempt', 'UN')`,
          tenantB.id,
        );
      }),
    ).rejects.toThrow();
  });

  it("stock_movements — a child table referencing product/store — is isolated by its OWN tenant_id, not only by join", async () => {
    const storeA = await seedStore(admin, tenantA.id);
    const storeB = await seedStore(admin, tenantB.id);
    const userA = await seedUser(admin, tenantA.id, { role: "operador" });

    await admin.query(
      `INSERT INTO stock_movements (tenant_id, product_id, store_id, type, quantity, created_by, balance_after)
       VALUES ($1, $2, $3, 'entrada_manual', 10, $4, 10)`,
      [tenantA.id, productA, storeA, userA.id],
    );

    const seenByB = await withTenant(tenantB.id, async (tx) => {
      return tx.$queryRawUnsafe<unknown[]>(`SELECT id FROM stock_movements`);
    });
    expect(seenByB).toEqual([]);
    void storeB; // seeded for symmetry / future extension, not directly asserted here
  });

  it("a query joining tenant-scoped tables cannot be used to smuggle another tenant's data through an unscoped join", async () => {
    const rows = await withTenant(tenantA.id, async (tx) => {
      // Even a join with no explicit tenant_id predicate on either side must stay scoped —
      // both `products` and `categories` are independently RLS-protected.
      return tx.$queryRawUnsafe<unknown[]>(
        `SELECT p.id FROM products p LEFT JOIN categories c ON c.id = p.category_id`,
      );
    });
    expect(rows.length).toBe(1);
  });
});
