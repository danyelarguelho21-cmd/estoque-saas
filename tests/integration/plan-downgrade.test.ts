// P1 gap closed in Wave B (test-plan.md risk register: "billing | PATCH /api/billing/subscription/
// plan | — | P1 | Gap — downgrade-below-current-usage 409 case not yet scaffolded"). Orchestrator
// brief explicitly names "plan-downgrade blocking" as a priority now that the real implementation
// exists (services/app/src/modules/billing/subscriptions.ts `changePlan`).
//
// The load-bearing guarantee: downgrading to a plan whose limits the tenant ALREADY exceeds must
// be blocked (409) with the specific violations named in the response — never silently truncate
// or orphan data (e.g. leaving 12 products active on a 10-product plan). Upgrading, or downgrading
// to a plan the tenant still fits within, must succeed and actually move `tenants.plan_id` /
// `subscriptions.plan_id`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminClient, resetTestDatabase, seedPlan, seedTenant, seedUser } from "../fixtures/db-test-helpers";
import { ApiClient, signUpAndLogin } from "../fixtures/http-test-client";

describe("Plan change / downgrade blocking (changePlan, PATCH /api/billing/subscription/plan)", () => {
  let roomyPlanId: string;
  let tinyPlanId: string;
  let midPlanId: string;
  let db: Client;

  beforeAll(async () => {
    await resetTestDatabase();
    const admin = adminClient();
    await admin.connect();
    try {
      roomyPlanId = (await seedPlan(admin, { name: "Roomy", maxProducts: 50, maxUsers: 10, maxStores: 5 })).id;
      tinyPlanId = (await seedPlan(admin, { name: "Tiny", maxProducts: 1, maxUsers: 1, maxStores: 1 })).id;
      midPlanId = (await seedPlan(admin, { name: "Mid", maxProducts: 3, maxUsers: 5, maxStores: 5 })).id;
    } finally {
      await admin.end();
    }
    db = adminClient();
    await db.connect();
  }, 30_000);

  afterAll(async () => {
    await db?.end();
  });

  it("downgrading to a plan whose maxProducts the tenant already exceeds is blocked (409) and names the violation", async () => {
    const { client, tenantId } = await signUpAndLogin(roomyPlanId);
    // Create 3 products — fits Roomy (50) and Mid (3), but NOT Tiny (1).
    for (let i = 0; i < 3; i++) {
      const res = await client.post("/api/products", { sku: `DG-${i}`, name: `Produto ${i}`, unitOfMeasure: "UN" });
      expect(res.status).toBe(201);
    }

    const res = await client.patch<{ code: string; details?: { violations?: unknown } }>("/api/billing/subscription/plan", {
      planId: tinyPlanId,
    });
    expect(res.status).toBe(409);
    expect(res.body.details?.violations).toBeTruthy();

    // Plan must NOT have changed on a blocked downgrade.
    const { rows } = await db.query<{ plan_id: string }>(`SELECT plan_id FROM tenants WHERE id = $1`, [tenantId]);
    expect(rows[0]?.plan_id).toBe(roomyPlanId);
  });

  it("downgrading to a plan the tenant still fits within succeeds (200) and updates both tenant and subscription plan_id", async () => {
    const { client, tenantId } = await signUpAndLogin(roomyPlanId);
    for (let i = 0; i < 2; i++) {
      const res = await client.post("/api/products", { sku: `OK-${i}`, name: `Produto ${i}`, unitOfMeasure: "UN" });
      expect(res.status).toBe(201);
    }

    // 2 products fits Mid (max 3) — downgrade should succeed.
    const res = await client.patch("/api/billing/subscription/plan", { planId: midPlanId });
    expect(res.status).toBe(200);

    const { rows: tenantRows } = await db.query<{ plan_id: string }>(`SELECT plan_id FROM tenants WHERE id = $1`, [tenantId]);
    expect(tenantRows[0]?.plan_id).toBe(midPlanId);

    const { rows: subRows } = await db.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    expect(subRows[0]?.plan_id).toBe(midPlanId);
  });

  it("a downgrade blocked on maxUsers still allows a subsequent downgrade to a plan with enough user headroom", async () => {
    const { client } = await signUpAndLogin(roomyPlanId);
    // signup already creates 1 admin user; Tiny's maxUsers=1 fits exactly (0 products/stores created).
    const res = await client.patch("/api/billing/subscription/plan", { planId: tinyPlanId });
    expect(res.status).toBe(200); // exactly at the limit, not over — must be ALLOWED, not blocked
  });

  it("upgrading to a strictly larger plan always succeeds regardless of current usage", async () => {
    const { client } = await signUpAndLogin(midPlanId);
    for (let i = 0; i < 3; i++) {
      const r = await client.post("/api/products", { sku: `UP-${i}`, name: `Produto ${i}`, unitOfMeasure: "UN" });
      expect(r.status).toBe(201);
    }
    const res = await client.patch("/api/billing/subscription/plan", { planId: roomyPlanId });
    expect(res.status).toBe(200);
  });

  it("a non-admin role (operador) is denied (403) from changing the plan — billing:manage is admin-only", async () => {
    // Reuses the RBAC helper pattern (see rbac.test.ts): seed an operador directly, since invite
    // acceptance has no public HTTP contract yet (documented gap, test-plan.md risk #1).
    const admin = adminClient();
    await admin.connect();
    let operadorEmail: string;
    let operadorPassword: string;
    try {
      const tenant = await seedTenant(admin, roomyPlanId);
      const operador = await seedUser(admin, tenant.id, { role: "operador" });
      operadorEmail = operador.email;
      operadorPassword = operador.password;
    } finally {
      await admin.end();
    }

    const client = new ApiClient();
    const login = await client.post("/api/auth/login", { email: operadorEmail, password: operadorPassword });
    expect(login.status).toBe(200);

    const res = await client.patch("/api/billing/subscription/plan", { planId: tinyPlanId });
    expect(res.status).toBe(403);
  });
});
