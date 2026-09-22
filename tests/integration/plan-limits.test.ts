// AC-007 (BRD) — "Dado que uma empresa atinge o limite de produtos/usuários/lojas do seu plano,
// então o sistema bloqueia a criação de novos registros do tipo excedido e exibe CTA de upgrade
// — a verificação é em tempo real, não em batch."
//
// HTTP-level integration test: exercises the real POST /api/products, /api/stores,
// /api/users/invite route handlers per api/openapi/catalog.yaml, tenants.yaml and auth.yaml.
// Requires the app to be running against a database seeded with a low-limit plan — see
// tests/integration/setup.ts and TEST_BASE_URL / TEST_DATABASE_URL env vars.
import { beforeAll, describe, expect, it } from "vitest";
import { adminClient, resetTestDatabase, seedPlan } from "../fixtures/db-test-helpers";
import { signUpAndLogin } from "../fixtures/http-test-client";

describe("Plan limit enforcement, checked in real time on creation (AC-007)", () => {
  let tinyPlanId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    const admin = adminClient();
    await admin.connect();
    try {
      const plan = await seedPlan(admin, { name: "Micro", maxProducts: 2, maxUsers: 2, maxStores: 1 });
      tinyPlanId = plan.id;
    } finally {
      await admin.end();
    }
  }, 30_000);

  it("blocks creating a product past maxProducts and returns the PlanLimitReached contract shape", async () => {
    const { client } = await signUpAndLogin(tinyPlanId);

    const first = await client.post("/api/products", { sku: "P1", name: "Produto 1", unitOfMeasure: "UN" });
    expect(first.status).toBe(201);
    const second = await client.post("/api/products", { sku: "P2", name: "Produto 2", unitOfMeasure: "UN" });
    expect(second.status).toBe(201);

    const third = await client.post<{ code: string; message: string; trace_id: string }>("/api/products", {
      sku: "P3",
      name: "Produto 3 (deve ser bloqueado)",
      unitOfMeasure: "UN",
    });

    expect(third.status).toBe(409);
    expect(third.body).toMatchObject({ code: expect.any(String), message: expect.any(String), trace_id: expect.any(String) });
  });

  it("blocks creating a store past maxStores (limit=1 for the Micro plan)", async () => {
    const { client } = await signUpAndLogin(tinyPlanId);

    // A tenant is created with zero stores at signup per the contract in auth.yaml — the first
    // store creation should succeed, the second must be blocked.
    const first = await client.post("/api/stores", { name: "Loja 1", type: "loja" });
    expect(first.status).toBe(201);

    const second = await client.post("/api/stores", { name: "Loja 2 (deve ser bloqueada)", type: "loja" });
    expect(second.status).toBe(409);
  });

  it("blocks inviting a user past maxUsers (limit=2, counting the admin created at signup)", async () => {
    const { client } = await signUpAndLogin(tinyPlanId);

    // The signup admin already counts as user #1 against maxUsers=2.
    const invite1 = await client.post("/api/users/invite", { name: "Op 1", email: "op1@example.com", role: "operador" });
    expect(invite1.status).toBe(201);

    const invite2 = await client.post("/api/users/invite", { name: "Op 2 (deve ser bloqueado)", email: "op2@example.com", role: "operador" });
    expect(invite2.status).toBe(409);
  });

  it("the limit check is real-time, not batch: a product created right after another tenant frees up headroom on a SHARED plan does not leak headroom across tenants", async () => {
    // Regression guard for a subtle bug class: if the limit check were ever implemented as
    // "COUNT(*) across all tenants on this plan" instead of "COUNT(*) for THIS tenant", two
    // tenants sharing the same plan would incorrectly affect each other's limits.
    const tenant1 = await signUpAndLogin(tinyPlanId);
    const tenant2 = await signUpAndLogin(tinyPlanId);

    await tenant1.client.post("/api/products", { sku: "T1-A", name: "A", unitOfMeasure: "UN" });
    await tenant1.client.post("/api/products", { sku: "T1-B", name: "B", unitOfMeasure: "UN" });
    // tenant1 is now at its limit (2/2) — tenant2 must still be able to create up to ITS OWN limit.
    const tenant2First = await tenant2.client.post("/api/products", { sku: "T2-A", name: "A", unitOfMeasure: "UN" });
    expect(tenant2First.status).toBe(201);
  });
});
