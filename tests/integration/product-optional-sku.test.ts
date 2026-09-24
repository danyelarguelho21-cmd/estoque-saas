import { beforeAll, describe, expect, it } from "vitest";
import { adminClient, resetTestDatabase, seedPlan } from "../fixtures/db-test-helpers";
import { signUpAndLogin } from "../fixtures/http-test-client";

describe("Product creation with optional SKU", () => {
  let planId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    const db = adminClient();
    await db.connect();
    try {
      planId = (await seedPlan(db, {})).id;
    } finally {
      await db.end();
    }
  }, 30_000);

  it("creates a product without a SKU and persists NULL in Postgres", async () => {
    const { client, tenantId } = await signUpAndLogin(planId);
    const created = await client.post<{ id: string; sku: string | null }>("/api/products", {
      name: "Produto sem referência interna",
      unitOfMeasure: "UN",
    });

    expect(created.status).toBe(201);
    expect(created.body.sku).toBeNull();

    const db = adminClient();
    await db.connect();
    try {
      const result = await db.query<{ sku: string | null }>(
        "SELECT sku FROM products WHERE tenant_id = $1 AND id = $2",
        [tenantId, created.body.id],
      );
      expect(result.rows).toEqual([{ sku: null }]);
    } finally {
      await db.end();
    }
  }, 15_000);
});
