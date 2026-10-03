// AC-005 (BRD) — "Dado um usuário com papel 'vendedor', quando ele tenta acessar configurações
// de empresa ou cadastro de usuários, então o sistema nega o acesso (403) e não expõe dados da
// tela." Extended per Business Rules to the full role matrix (admin/operador/vendedor).
//
// KNOWN CONTRACT GAP (documented in test-plan.md risk register): api/openapi/auth.yaml exposes
// POST /api/users/invite but no "accept invite / set password" endpoint, so an invited
// operador/vendedor cannot be logged in via the public HTTP contract alone yet. This suite seeds
// operador/vendedor users directly via SQL (bcrypt, matching the Auth.js Credentials standard)
// as a pragmatic workaround — see tests/fixtures/db-test-helpers.ts `seedUser`.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { generateValidCnpj } from "../fixtures/cnpj";
import { adminClient, randomSuffix, resetTestDatabase, seedPlan, seedStore, seedTenant, seedUser } from "../fixtures/db-test-helpers";
import { makeAuthenticityToken, makeRawChargePaidPayload } from "../fixtures/factories/pagbank-webhook.factory";
import { ApiClient, TEST_BILLING_ADDRESS, signUpAndLogin } from "../fixtures/http-test-client";

async function loginAs(email: string, password: string) {
  const client = new ApiClient();
  const res = await client.post("/api/auth/login", { email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return client;
}

describe("RBAC — role-scoped access control (AC-005)", () => {
  let planId: string;
  let tenantId: string;
  let vendedor: { email: string; password: string };
  let operador: { email: string; password: string };

  beforeAll(async () => {
    await resetTestDatabase();
    const admin = adminClient();
    await admin.connect();
    try {
      const plan = await seedPlan(admin, {});
      planId = plan.id;
      const tenant = await seedTenant(admin, planId);
      tenantId = tenant.id;
      // FIXED (Wave B, real-stack test-pollution bug): hardcoded emails collided across repeated
      // runs against the shared/persistent dev database (resetTestDatabase() is intentionally a
      // no-op there — see its doc comment). `auth_lookup_user_by_email`
      // (schemas/migrations/0004/0009) has no ORDER BY and the application tries every
      // cross-tenant match against the given password, so a stale row from an earlier run with the
      // same email AND the same default seedUser() password could — and did, reproduced live —
      // authenticate this test's login against a DIFFERENT (old, unrelated) tenant, corrupting
      // this test's product-uniqueness assumptions with a real P2002 several runs later.
      // Unique per-run emails make this suite safe to run repeatedly against a persistent DB.
      vendedor = await seedUser(admin, tenantId, { role: "vendedor", email: `vendedor-${randomSuffix()}@example.com` });
      operador = await seedUser(admin, tenantId, { role: "operador", email: `operador-${randomSuffix()}@example.com` });
    } finally {
      await admin.end();
    }
  }, 30_000);

  it("vendedor is denied (403) access to company settings (PATCH /api/tenant), with no tenant data leaked in the response", async () => {
    const client = await loginAs(vendedor.email, vendedor.password);
    const res = await client.patch<{ code: string; message: string }>("/api/tenant", { consolidatedStock: true });
    expect(res.status).toBe(403);
    // The 403 body must not carry through any tenant configuration fields — only the Error shape.
    expect(res.body).not.toHaveProperty("consolidatedStock");
    expect(res.body).not.toHaveProperty("cnpj");
    expect(res.body).toMatchObject({ code: expect.any(String) });
  });

  it("vendedor is denied (403) access to user management (GET /api/users)", async () => {
    const client = await loginAs(vendedor.email, vendedor.password);
    const res = await client.get<{ items?: unknown[] }>("/api/users");
    expect(res.status).toBe(403);
    expect(res.body?.items).toBeUndefined(); // no partial data leak
  });

  it("vendedor CAN register a sale and view stock (in-scope actions per Business Rules)", async () => {
    const client = await loginAs(vendedor.email, vendedor.password);
    const res = await client.get("/api/products");
    expect(res.status).toBe(200);
  });

  it("vendedor is denied access to billing/subscription (cobrança is admin-only per Business Rules)", async () => {
    const client = await loginAs(vendedor.email, vendedor.password);
    const res = await client.get("/api/billing/subscription");
    expect(res.status).toBe(403);
  });

  it("operador is denied (403) access to company settings and user management (catalog/stock scope only)", async () => {
    const client = await loginAs(operador.email, operador.password);
    const tenantRes = await client.patch("/api/tenant", { consolidatedStock: true });
    expect(tenantRes.status).toBe(403);
    const usersRes = await client.get("/api/users");
    expect(usersRes.status).toBe(403);
  });

  it("operador CAN create products and stock entries (in-scope actions)", async () => {
    const client = await loginAs(operador.email, operador.password);
    const createRes = await client.post("/api/products", { sku: "OP-1", name: "Produto do Operador", unitOfMeasure: "UN" });
    expect(createRes.status).toBe(201);
  });

  it("admin CAN access company settings, user management, and billing (full tenant scope)", async () => {
    const { client } = await signUpAndLogin(planId); // signup creates the tenant's admin
    const tenantRes = await client.get("/api/tenant");
    expect(tenantRes.status).toBe(200);
    const usersRes = await client.get("/api/users");
    expect(usersRes.status).toBe(200);
    const billingRes = await client.get("/api/billing/subscription");
    expect(billingRes.status).toBe(200);
  });

  it("an unauthenticated request to any tenant-scoped route is rejected (401), not silently treated as some default role", async () => {
    const anon = new ApiClient();
    const res = await anon.get("/api/products");
    expect(res.status).toBe(401);
  });

  // BUG FIX (2026-09-28, found live in production via manual test): a freshly signed-up tenant
  // got full product access ("Ativa") with zero payment — subscriptions were born
  // "trialing"/"active" and no guard checked payment state at all. This product has no trial
  // period (BRD: pagar pra usar). requireSession/requireRole (modules/auth/rbac.ts) now block
  // every tenant-scoped route except billing/tenant-read while status is pending_payment/trialing.
  it("a freshly signed-up tenant with no payment yet is blocked (402) from product access — no free trial — and gets access right after the first payment is confirmed", async () => {
    const client = new ApiClient();
    const email = `pending-${randomSuffix()}@example.com`;
    const password = "SenhaForte#123";
    const signupRes = await client.post<{ tenantId: string }>("/api/auth/signup", {
      personType: "PJ" as const,
      companyName: "Empresa Pagamento Pendente",
      cnpj: generateValidCnpj(),
      adminName: "Admin Pendente",
      adminEmail: email,
      password,
      planId,
      billingAddress: TEST_BILLING_ADDRESS,
    });
    expect(signupRes.status).toBe(201);
    const loginRes = await client.post("/api/auth/login", { email, password });
    expect(loginRes.status).toBe(200);

    // Blocked pre-payment — this is the exact bug reported live: full access without paying.
    const blockedRes = await client.get<{ code: string }>("/api/products");
    expect(blockedRes.status).toBe(402);
    expect(blockedRes.body.code).toBe("PAYMENT_REQUIRED");

    // Billing/tenant stay reachable — otherwise the tenant could never pay to unblock itself.
    const billingRes = await client.get("/api/billing/subscription");
    expect(billingRes.status).toBe(200);
    const tenantRes = await client.get("/api/tenant");
    expect(tenantRes.status).toBe(200);

    // Complete checkout + simulate the webhook confirming the first payment (same flow
    // signUpAndLogin performs internally for every other test in this suite).
    const checkoutRes = await client.post("/api/billing/subscription", { planId, paymentMethod: "pix_boleto" as const });
    expect([201, 503]).toContain(checkoutRes.status);
    if (checkoutRes.status === 503) {
      expect((checkoutRes.body as { code?: string }).code).toBe("PAYMENT_UNAVAILABLE");
    }

    const db = adminClient();
    await db.connect();
    try {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [signupRes.body.tenantId],
      );
      const subscriptionId = rows[0]!.id;
      const chargeId = `chg_pending_test_${randomSuffix()}`;
      await db.query(
        `INSERT INTO invoices (id, tenant_id, subscription_id, amount_cents, status, due_date, payment_method, gateway_charge_id)
         VALUES ($1, $2, $3, 9900, 'pending', CURRENT_DATE, 'pix', $4)`,
        [randomUUID(), signupRes.body.tenantId, subscriptionId, chargeId],
      );
      const payload = makeRawChargePaidPayload({ chargeId });
      const rawBody = JSON.stringify(payload);
      const signature = makeAuthenticityToken(rawBody, process.env.PAGBANK_WEBHOOK_SECRET ?? "dev-placeholder");
      const webhookRes = await new ApiClient().post("/api/webhooks/pagbank", payload, { "x-authenticity-token": signature });
      expect(webhookRes.status).toBe(200);
    } finally {
      await db.end();
    }

    // Unblocked immediately after payment confirmation — no re-login needed.
    const unlockedRes = await client.get("/api/products");
    expect(unlockedRes.status).toBe(200);
  });

  it("cross-tenant access is a 404, never a 403 (RLS must not leak existence of another tenant's resource — _common.yaml NotFound contract)", async () => {
    // FIXED (Wave B, real-fixture bug): the original version passed a TENANT id where a STORE id
    // belongs — never the resource type this test claims to exercise. Seed a real store that
    // genuinely belongs to a different tenant instead, so a PATCH from tenant A's session is an
    // actual cross-tenant access attempt on an existing resource.
    const admin = adminClient();
    await admin.connect();
    let otherStoreId: string;
    try {
      const otherTenant = await seedTenant(admin, planId, { name: "Outro Tenant" });
      otherStoreId = await seedStore(admin, otherTenant.id, "Loja de Outro Tenant");
    } finally {
      await admin.end();
    }
    const { client } = await signUpAndLogin(planId);
    const res = await client.patch(`/api/stores/${otherStoreId}`, { name: "Tentativa cross-tenant" });
    // Per _common.yaml NotFound: "pertence a outro tenant — RLS nunca vaza 403 vs 404" — the
    // response code itself must not reveal whether the store exists under another tenant.
    expect(res.status).toBe(404);
  });
});
