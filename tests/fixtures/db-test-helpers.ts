// Shared DB test helpers — owned by QA (tests/ is the oracle of record, loop-protocol Rule 4).
//
// Connects directly to the TEST database (never the dev/prod one) using a superuser-ish
// connection string (TEST_DATABASE_URL) that is allowed to reset schema and bypass RLS for
// setup/verification purposes — mirrors the "administrative migration user" carve-out described
// in ADR-002 (only a separate admin user has BYPASSRLS; the app_user does not).
//
// These helpers apply schemas/migrations/0001_init.sql directly (the SQL source of truth for
// RLS policies per ADR-002) rather than `prisma migrate`, because at Wave-A time the Prisma
// schema is intentionally incomplete (see libs/shared/prisma/schema.prisma comment — full model
// set lands during BUILD). Once the backend engineer's Prisma migrations exist, this helper
// should be updated to run `prisma migrate deploy` instead — tracked as a QA follow-up, not a
// blocker for the acceptance scaffolds themselves.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const MIGRATION_SQL_PATH = path.join(REPO_ROOT, "schemas/migrations/0001_init.sql");

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://estoque_app:devpassword@localhost:5433/estoque_saas_test";

/**
 * Drops and recreates the public schema, then re-applies the RLS migration SQL that is the
 * source of truth per ADR-002. Call once per test file (or per suite) in beforeAll.
 *
 * Requires a real Postgres reachable at TEST_DATABASE_URL — see tests/integration/docker-compose.test.yml.
 * If unreachable, throws; callers should let the test fail loudly (an integration suite that
 * silently skips because "no DB" is not an oracle — loop-protocol Rule 1).
 */
export async function resetTestDatabase(): Promise<void> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const sql = readFileSync(MIGRATION_SQL_PATH, "utf-8");
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/** Raw (RLS-bypassing, admin-role) client for test setup/verification only — never used to
 * simulate application behavior, only to seed fixtures and to assert ground truth. */
export function adminClient(): Client {
  return new Client({ connectionString: TEST_DATABASE_URL });
}

export interface SeededPlan {
  id: string;
  name: string;
  maxProducts: number;
  maxUsers: number;
  maxStores: number;
}

export async function seedPlan(
  client: Client,
  overrides: Partial<{ name: string; priceCents: number; maxProducts: number; maxUsers: number; maxStores: number }> = {},
): Promise<SeededPlan> {
  const name = overrides.name ?? "Básico";
  const priceCents = overrides.priceCents ?? 9900;
  const maxProducts = overrides.maxProducts ?? 50;
  const maxUsers = overrides.maxUsers ?? 5;
  const maxStores = overrides.maxStores ?? 2;
  const res = await client.query<{ id: string }>(
    `INSERT INTO plans (name, price_cents, max_products, max_users, max_stores)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, priceCents, maxProducts, maxUsers, maxStores],
  );
  return { id: res.rows[0]!.id, name, maxProducts, maxUsers, maxStores };
}

export interface SeededTenant {
  id: string;
  cnpj: string;
}

export async function seedTenant(
  client: Client,
  planId: string,
  overrides: Partial<{ name: string; cnpj: string; perishableTrackingEnabled: boolean; consolidatedStock: boolean }> = {},
): Promise<SeededTenant> {
  const cnpj = overrides.cnpj ?? randomCnpj();
  const res = await client.query<{ id: string }>(
    `INSERT INTO tenants (name, cnpj, plan_id, perishable_tracking_enabled, consolidated_stock)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      overrides.name ?? "Empresa Teste",
      cnpj,
      planId,
      overrides.perishableTrackingEnabled ?? true,
      overrides.consolidatedStock ?? false,
    ],
  );
  return { id: res.rows[0]!.id, cnpj };
}

export interface SeededUser {
  id: string;
  email: string;
  password: string;
  role: "admin" | "operador" | "vendedor";
}

/**
 * Seeds a user directly via SQL with a known plaintext password (bcrypt-hashed).
 *
 * NOTE (risk, documented in test-plan.md): api/openapi/auth.yaml defines /api/users/invite but
 * no "accept invite / set password" endpoint, so an invited operador/vendedor cannot currently
 * be logged in via the public contract alone. This helper is the pragmatic QA workaround for
 * RBAC test setup and assumes bcrypt for password hashing (the de facto standard for an Auth.js
 * Credentials provider) — if the backend implementation hashes differently, update this helper,
 * not the RBAC test's assertions.
 */
export async function seedUser(
  client: Client,
  tenantId: string,
  overrides: Partial<{ name: string; email: string; password: string; role: "admin" | "operador" | "vendedor"; status: string }> = {},
): Promise<SeededUser> {
  const password = overrides.password ?? "SenhaForte#123";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = overrides.email ?? `user-${randomSuffix()}@example.com`;
  const role = overrides.role ?? "vendedor";
  const res = await client.query<{ id: string }>(
    `INSERT INTO users (tenant_id, name, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, overrides.name ?? "Usuário Teste", email, passwordHash, role, overrides.status ?? "active"],
  );
  return { id: res.rows[0]!.id, email, password, role };
}

export async function seedStore(client: Client, tenantId: string, name = "Loja Central"): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO stores (tenant_id, name, type) VALUES ($1, $2, 'loja') RETURNING id`,
    [tenantId, name],
  );
  return res.rows[0]!.id;
}

export async function seedProduct(
  client: Client,
  tenantId: string,
  overrides: Partial<{ sku: string; name: string; isPerishable: boolean; minStockGlobal: number; barcode: string }> = {},
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO products (tenant_id, sku, name, unit_of_measure, is_perishable, min_stock_global, barcode)
     VALUES ($1, $2, $3, 'UN', $4, $5, $6) RETURNING id`,
    [
      tenantId,
      overrides.sku ?? `SKU-${randomSuffix()}`,
      overrides.name ?? "Produto Teste",
      overrides.isPerishable ?? false,
      overrides.minStockGlobal ?? 0,
      overrides.barcode ?? null,
    ],
  );
  return res.rows[0]!.id;
}

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function randomCnpj(): string {
  // Not a validity-checked CNPJ — good enough as a unique test fixture value.
  const digits = Array.from({ length: 14 }, () => Math.floor(Math.random() * 10)).join("");
  return digits;
}
