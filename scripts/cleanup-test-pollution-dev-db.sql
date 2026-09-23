-- scripts/cleanup-test-pollution-dev-db.sql
--
-- One-time cleanup for the real dev database (docker-compose.yml's `postgres` service, port
-- 5432, db `estoque_saas`) — found polluted with 168 test-origin tenants and 49 plan rows
-- (should be exactly 3: Básico/Pro/Enterprise from scripts/seed-plans.mjs).
--
-- ROOT CAUSE: tests/fixtures/db-test-helpers.ts's seedPlan() (and the tenant/user/store/product
-- seed helpers built on it) INSERT unconditionally with no existence check and no per-call unique
-- name — safe against the isolated ephemeral test container (tests/integration/docker-compose.test.yml,
-- port 5433, db `estoque_saas_test`, wiped on every `docker compose down -v`), but ANY integration
-- test run that got pointed at the persistent dev database instead (TEST_DATABASE_URL set to port
-- 5432, e.g. during an earlier QA/HARDEN pass that ran the suite "against the real Docker stack")
-- accumulates a new row on every single run, forever, since nothing ever cleans it up.
--
-- This script is a manual, one-time remediation — the actual prevention is a guard added in
-- tests/fixtures/db-test-helpers.ts (this same commit) that refuses to run ANY seed/reset helper
-- against a database whose name isn't literally "estoque_saas_test", closing this permanently.
--
-- SAFETY: every single one of the 168 tenants in the dev DB at the time this was written was
-- confirmed to be test/debug data (names like "Empresa Teste", "Tenant A/B", "QA Debug Co",
-- "NFe Debug", timestamped "Empresa QA <epoch-ms>") — this is a pre-launch system with zero real
-- customers yet. Reviewed and approved by the project owner before running. Run this against the
-- DEV database only — never against a database with real customer data.
--
-- Usage: psql "postgresql://estoque_app:devpassword@localhost:5432/estoque_saas" -f scripts/cleanup-test-pollution-dev-db.sql
-- (adjust the connection string/password to match your .env if you changed POSTGRES_PASSWORD)

BEGIN;

-- Wipes ALL tenants and, via FK CASCADE (schemas/migrations/0001_init.sql / 0002_remaining_tables.sql
-- — every tenant-scoped table's tenant_id FK references tenants(id)), every row in every
-- tenant-scoped table transitively: users, stores, subscriptions, invoices, suppliers, categories,
-- products, product_store_settings, batches, stock_movements, nfe_imports, nfe_import_items,
-- customers, sales, sale_items, transfers, transfer_items, stock_alerts_config, notifications,
-- audit_log. Does NOT touch `plans` (referenced BY tenants, not the reverse) or `platform_admins`
-- (not tenant-scoped, ADR-002).
TRUNCATE TABLE tenants CASCADE;

-- Keep only the 3 real plans (scripts/seed-plans.mjs's idempotent upsert-by-name — these ids are
-- from this dev DB's actual seed-plans.mjs run; re-verify with
-- `SELECT id, name, created_at FROM plans ORDER BY created_at LIMIT 3` if seed-plans.mjs was
-- re-run since this script was written, since a re-run UPDATES in place and keeps the same ids,
-- but confirm before trusting a hardcoded id list blindly).
DELETE FROM plans
WHERE id NOT IN (
  '369612af-2fb0-421f-a2d5-69e8b1eff452', -- Básico
  '5c401594-448e-4f24-83d4-e2cde62ba52b', -- Pro
  '247a4fb3-c08d-4006-a240-53b4b9879e46'  -- Enterprise
);

-- Verify before commit: expect 0 tenants, exactly 3 plans.
SELECT (SELECT count(*) FROM tenants) AS tenants_remaining, (SELECT count(*) FROM plans) AS plans_remaining;

COMMIT;
