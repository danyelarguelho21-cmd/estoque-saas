// AC-010 / ADR-002 — structural regression guard.
//
// ADR-002 names this test explicitly as its own mitigation for the "developer forgets to enable
// RLS on a new tenant-scoped table" risk:
//   "Mitigado com teste automatizado (QA) que varre o schema e falha o build se alguma tabela
//    com tenant_id não tiver RLS habilitada."
//
// This sweeps pg_catalog directly (not the Prisma schema) so it catches drift regardless of
// which layer introduced it — a new migration, a hand-written SQL change, or a Prisma model that
// forgot to be mirrored into schemas/migrations/*.sql.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resetTestDatabase, adminClient } from "../fixtures/db-test-helpers";

describe("RLS schema sweep (AC-010, ADR-002 mitigation)", () => {
  let client: Client;

  beforeAll(async () => {
    await resetTestDatabase();
    client = adminClient();
    await client.connect();
  }, 30_000);

  afterAll(async () => {
    await client?.end();
  });

  it("every table with a tenant_id column has ROW LEVEL SECURITY enabled", async () => {
    const { rows } = await client.query<{ table_name: string; rls_enabled: boolean }>(`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
      FROM information_schema.columns col
      JOIN pg_class c ON c.relname = col.table_name AND c.relkind = 'r'
      WHERE col.table_schema = 'public' AND col.column_name = 'tenant_id'
    `);

    expect(rows.length).toBeGreaterThan(0); // sanity: sweep actually found tenant-scoped tables

    const withoutRls = rows.filter((r) => !r.rls_enabled).map((r) => r.table_name);
    expect(withoutRls, `tables with tenant_id but RLS disabled: ${withoutRls.join(", ")}`).toEqual([]);
  });

  it("every RLS-enabled tenant table has a tenant_isolation policy defined", async () => {
    const { rows: tenantTables } = await client.query<{ table_name: string }>(`
      SELECT DISTINCT col.table_name
      FROM information_schema.columns col
      JOIN pg_class c ON c.relname = col.table_name AND c.relkind = 'r'
      WHERE col.table_schema = 'public' AND col.column_name = 'tenant_id'
    `);

    const { rows: policies } = await client.query<{ tablename: string; policyname: string }>(
      `SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'`,
    );
    const tablesWithPolicy = new Set(policies.map((p) => p.tablename));

    const missing = tenantTables.map((t) => t.table_name).filter((t) => !tablesWithPolicy.has(t));
    expect(missing, `tenant_id tables missing an RLS policy: ${missing.join(", ")}`).toEqual([]);
  });

  it("the `tenants` table itself is RLS-protected using its own id as the tenant key", async () => {
    const { rows } = await client.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'tenants'`,
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it("`plans` and `platform_admins` remain intentionally global (RLS disabled) per ADR-002", async () => {
    const { rows } = await client.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('plans', 'platform_admins')`,
    );
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} should NOT have RLS enabled (global table)`).toBe(false);
    }
  });

  it("`app_user` role cannot UPDATE or DELETE audit_log rows (ADR-007 immutability)", async () => {
    const { rows } = await client.query<{ privilege_type: string }>(`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'audit_log' AND grantee = 'estoque_app'
    `);
    const privileges = rows.map((r) => r.privilege_type);
    // NOTE: this assumes the app DB role is named 'estoque_app' (matches docker-compose.yml
    // POSTGRES_USER / .env.example). If DevOps provisions a differently-named least-privilege
    // role for the app (vs. the migration-admin role), update this constant — the intent
    // (INSERT/SELECT yes, UPDATE/DELETE no) is the load-bearing assertion.
    expect(privileges).not.toContain("UPDATE");
    expect(privileges).not.toContain("DELETE");
  });
});
