// Thin HTTP client for integration/e2e-api tests that exercise the real running Next.js app
// (services/app) over the network, per the OpenAPI contracts in api/openapi/*.yaml.
//
// Deliberately NOT importing Next.js route handlers directly and NOT mocking Auth.js: hitting
// real HTTP + real cookies is the only way to test the actual boundary (auth middleware, RBAC,
// RLS-scoped Prisma calls, webhook signature verification) end-to-end (boundary-safety Pattern 5).
// Requires the app to be running — see tests/integration/docker-compose.test.yml and
// tests/integration/setup.ts. If TEST_BASE_URL is unreachable, tests fail loudly (not skipped).

import { randomUUID } from "node:crypto";
import { generateValidCnpj } from "./cnpj";
import { adminClient } from "./db-test-helpers";
import { makeAuthenticityToken, makeRawChargePaidPayload } from "./factories/pagbank-webhook.factory";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3100";

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  setCookie: string | null;
}

export class ApiClient {
  // FIXED (Wave B, real-stack bug): a single `string | null` field can only ever hold ONE
  // cookie. Auth.js/NextAuth sets MULTIPLE cookies across the signup -> login flow (CSRF token on
  // signup, then a *different* `authjs.callback-url` AND the actual session cookie
  // `session-dev`/`__Secure-session` on login) — verified for real against the running app with
  // curl. Overwriting a single field on every response silently DROPPED the session cookie the
  // moment login's `authjs.callback-url` Set-Cookie header arrived after it, so every
  // "authenticated" request after login/signup was actually sent with no session cookie at all
  // and came back 401. Real bug caught running these tests against Docker for real, not visible
  // when nothing could actually connect (Wave A). Fixed by keeping a proper cookie jar
  // (name -> value), merged across every response, so a new Set-Cookie only replaces the cookie
  // with the SAME name — every other previously-received cookie (notably the session cookie) is
  // preserved and sent on every subsequent request.
  private readonly jar = new Map<string, string>();

  constructor(private readonly baseUrl: string = BASE_URL) {}

  /** Replaces the entire cookie jar with a single raw cookie string (e.g. "name=value"). Mostly
   * useful for tests that want to inject/forge a specific cookie value directly. */
  withCookie(cookie: string | null): this {
    this.jar.clear();
    if (cookie) {
      for (const pair of cookie.split(";")) {
        const eq = pair.indexOf("=");
        if (eq === -1) continue;
        this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
    return this;
  }

  /** The full `Cookie` request header value this client would currently send. */
  get sessionCookie(): string | null {
    if (this.jar.size === 0) return null;
    return Array.from(this.jar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  private absorbSetCookies(res: Response): void {
    const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const rawCookies = typeof getSetCookie === "function"
      ? getSetCookie.call(res.headers)
      : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const raw of rawCookies) {
      const firstPair = raw.split(";")[0] ?? "";
      const eq = firstPair.indexOf("=");
      if (eq === -1) continue;
      const name = firstPair.slice(0, eq).trim();
      const value = firstPair.slice(eq + 1).trim();
      this.jar.set(name, value);
    }
  }

  async request<T = unknown>(
    method: string,
    urlPath: string,
    options: {
      body?: unknown | undefined;
      multipart?: FormData | undefined;
      headers?: Record<string, string> | undefined;
    } = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...options.headers };
    const cookieHeader = this.sessionCookie;
    if (cookieHeader) headers["cookie"] = cookieHeader;

    let body: string | FormData | undefined;
    if (options.multipart) {
      body = options.multipart;
    } else if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const init: RequestInit = { method, headers, redirect: "manual" };
    if (body !== undefined) init.body = body;
    const res = await fetch(`${this.baseUrl}${urlPath}`, init);
    const setCookie = res.headers.get("set-cookie");
    this.absorbSetCookies(res);

    const contentType = res.headers.get("content-type") ?? "";
    const parsedBody = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text().catch(() => null);

    return { status: res.status, body: parsedBody as T, headers: res.headers, setCookie };
  }

  get<T = unknown>(urlPath: string, headers?: Record<string, string>) {
    return this.request<T>("GET", urlPath, { headers });
  }
  post<T = unknown>(urlPath: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>("POST", urlPath, { body, headers });
  }
  patch<T = unknown>(urlPath: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>("PATCH", urlPath, { body, headers });
  }
  delete<T = unknown>(urlPath: string, headers?: Record<string, string>) {
    return this.request<T>("DELETE", urlPath, { headers });
  }
  postMultipart<T = unknown>(urlPath: string, form: FormData, headers?: Record<string, string>) {
    return this.request<T>("POST", urlPath, { multipart: form, headers });
  }
}

/** Signs up a fresh tenant + admin via the real /api/auth/signup contract, logs in, completes
 * pix/boleto checkout, and simulates the PagBank webhook confirming the first payment —
 * returning an authenticated ApiClient for a genuinely ACTIVE (paid) tenant. Used by every
 * integration/e2e-api test that needs a ready-to-use tenant instead of re-deriving one from raw
 * SQL (keeps tests close to the real onboarding contract per BRD Epic 1).
 *
 * BUG FIX (2026-09-28, production): signup used to grant full product access immediately
 * (subscription born "trialing"/"active" with no payment) — this product has no trial period
 * (BRD: pagar pra usar), so requireSession/requireRole (modules/auth/rbac.ts) now block a
 * pending_payment tenant from every route except billing/tenant-read. Every EXISTING test that
 * calls this helper expects a tenant that can actually use products/stock/sales/etc., so this
 * helper completes the real checkout -> webhook flow itself (the same one a real paying customer
 * goes through) rather than reaching around it — keeping the fixture's promise ("close to the
 * real onboarding contract") true post-fix. Tests that specifically need a pending_payment tenant
 * (the gate itself) build one manually instead — see tests/integration/rbac.test.ts. */
// Endereço de cobrança obrigatório no signup (SignupSchema) — exigido pelo Pix da Vindi.
export const TEST_BILLING_ADDRESS = {
  zipcode: "01310100",
  street: "Avenida Paulista",
  number: "1000",
  complement: "",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

export async function signUpAndLogin(
  planId: string,
  overrides: Partial<{ companyName: string; cnpj: string; adminName: string; adminEmail: string; password: string }> = {},
): Promise<{ client: ApiClient; tenantId: string; userId: string; email: string; password: string }> {
  const client = new ApiClient();
  const email = overrides.adminEmail ?? `admin-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = overrides.password ?? "SenhaForte#123";
  const signupRes = await client.post<{ tenantId: string; userId: string }>("/api/auth/signup", {
    personType: "PJ" as const,
    companyName: overrides.companyName ?? "Empresa Teste",
    cnpj: overrides.cnpj ?? generateValidCnpj(),
    adminName: overrides.adminName ?? "Admin Teste",
    adminEmail: email,
    password,
    planId,
    billingAddress: TEST_BILLING_ADDRESS,
  });
  if (signupRes.status !== 201) {
    throw new Error(`signup failed: ${signupRes.status} ${JSON.stringify(signupRes.body)}`);
  }
  const loginRes = await client.post("/api/auth/login", { email, password });
  if (loginRes.status !== 200) {
    throw new Error(`login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  const { tenantId, userId } = signupRes.body;

  // billing:manage routes allow pending_payment (see rbac.ts) so this call works pre-payment.
  const checkoutRes = await client.post("/api/billing/subscription", { planId, paymentMethod: "pix_boleto" as const });
  // O gateway de teste é propositalmente inalcançável no CI (PAGBANK_BASE_URL=http://127.0.0.1:1),
  // então o checkout Pix responde 503 PAYMENT_UNAVAILABLE em vez de 201 — mesmo critério de
  // billing-subscription.test.ts (expectPixCheckoutResponse). A assinatura pending_payment já
  // existe desde o signup, que é tudo o que o restante deste helper precisa.
  const checkoutUnavailable =
    checkoutRes.status === 503 && (checkoutRes.body as { code?: string } | undefined)?.code === "PAYMENT_UNAVAILABLE";
  if (checkoutRes.status !== 201 && !checkoutUnavailable) {
    throw new Error(`checkout failed: ${checkoutRes.status} ${JSON.stringify(checkoutRes.body)}`);
  }

  // POST /api/billing/subscription doesn't itself create an invoice (that's generate-monthly-charge,
  // out of HTTP-testable scope — same reasoning as webhook-idempotency.test.ts) — seed one directly,
  // exactly the shape that job would produce, so the simulated webhook below has something real to match.
  const db = adminClient();
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    const subscriptionId = rows[0]?.id;
    if (!subscriptionId) throw new Error(`no subscription found for tenant ${tenantId} after checkout`);

    const chargeId = `chg_fixture_${randomUUID().slice(0, 8)}`;
    await db.query(
      `INSERT INTO invoices (id, tenant_id, subscription_id, amount_cents, status, due_date, payment_method, gateway_charge_id)
       VALUES ($1, $2, $3, 9900, 'pending', CURRENT_DATE, 'pix', $4)`,
      [randomUUID(), tenantId, subscriptionId, chargeId],
    );

    const payload = makeRawChargePaidPayload({ chargeId });
    const rawBody = JSON.stringify(payload);
    const signature = makeAuthenticityToken(rawBody, process.env.PAGBANK_WEBHOOK_SECRET ?? "dev-placeholder");
    const webhookRes = await new ApiClient().post("/api/webhooks/pagbank", payload, { "x-authenticity-token": signature });
    if (webhookRes.status !== 200) {
      throw new Error(`webhook payment simulation failed: ${webhookRes.status} ${JSON.stringify(webhookRes.body)}`);
    }
  } finally {
    await db.end();
  }

  return { client, tenantId, userId, email, password };
}
