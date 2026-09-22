# Runbook: Postgres RLS misconfiguration suspected / cross-tenant data leak

**Severity:** Critical (SEV-1) — always. Do not downgrade based on tenant count affected; a single cross-tenant record leaked is a full-severity security incident, not a reliability blip.
**Owns this runbook:** SRE (definitions/process). Ties to Security Engineer's threat model for STRIDE/tenant-isolation findings — if Security Engineer has produced `Claude-Production-Grade-Suite/security-engineer/`, cross-check its findings for this exact class of issue before assuming this is a novel bug.
**Architecture reference:** ADR-002 (multi-tenancy strategy — shared schema + RLS), ADR-001 (module boundaries).

## What this looks like in practice

- A user from Tenant A sees a product, stock movement, sale, or customer record belonging to Tenant B.
- An internal alert fires from the automated RLS-coverage test (ADR-002: schema scan that fails the build if a `tenant_id` table doesn't have RLS enabled) — either in CI (caught before prod) or via a production canary check (caught in prod — worse).
- A support/bug report describes data that "shouldn't be visible" to the reporting tenant.
- Any `SELECT` in production logs/APM shows a query returning rows where `tenant_id` doesn't match the requesting session's tenant.

**Do not wait for a pattern.** One credible report is enough to start this runbook.

## Immediate triage (first 5 minutes)

1. **Confirm it's real, not a UI display bug.** Cross-tenant leaks can look identical to a frontend bug that mislabels/misroutes data that actually IS correctly scoped. Reproduce at the data layer, not just the screen:
   ```sql
   -- Connect as app_user (the RLS-restricted role), NOT the migration/admin role.
   -- Set a known tenant context, then query the table where the leak was reported.
   SELECT set_config('app.tenant_id', '<tenant-A-uuid>', true);
   SELECT id, tenant_id FROM <affected_table> WHERE id = '<the-leaked-record-id>';
   -- If this returns a row whose tenant_id != tenant-A-uuid, RLS is not enforcing. Confirmed leak.
   -- If this returns zero rows, the leak may be an application-layer bug (e.g. wrong ID passed
   -- to a different, correctly-scoped query) — still urgent, but a different runbook (app bug, not RLS).
   ```
2. **If confirmed:** this is a live security incident. Do not wait to "investigate more" before containing — see Containment below.
3. **If NOT confirmed as RLS (i.e. app-layer bug instead):** hand off to Software Engineer as a Critical bug, not this runbook. Still worth a quick RLS sanity check (step 4 below) since app bugs and RLS gaps can coexist.

## Containment (stop the bleeding)

Choose the narrowest option that actually stops exposure — don't reach for "take the whole app down" if a scoped fix is available, but don't hesitate to use it if the affected table/module can't be isolated quickly.

- **Option A — narrow (preferred):** if the leak is isolated to one module/table (e.g. only `stock_movements`), and that module can be feature-flagged or its route handlers can return 503 without taking down the rest of the app, do that first.
- **Option B — broad:** if containment can't be scoped quickly, stop the `app` container (`docker compose stop app`) to halt all traffic. The `worker` container may also need stopping if the leak path includes background jobs writing/reading cross-tenant (e.g. NF-e import, billing reconciliation) — check before deciding.
- **Always:** capture evidence before remediating — the exact query, the two tenant IDs involved, timestamps, and (if determinable) how many distinct tenants/records were exposed. This is needed for the post-incident write-up and, depending on scope, may be an LGPD-relevant disclosure question (flag to the founder/CEO — this runbook does not make that legal call).

## Root-cause checklist (work top to bottom — most common causes first)

1. **Is RLS actually enabled on the table?**
   ```sql
   SELECT relname, relrowsecurity, relforcerowsecurity
   FROM pg_class
   WHERE relname = '<affected_table>';
   -- relrowsecurity must be 't'. If 'f', RLS was never enabled on this table — likely a new
   -- table added without following the ADR-002 checklist (tenant_id + RLS + policy).
   ```
2. **Does the table have a policy, and is it the expected one?**
   ```sql
   SELECT polname, polcmd, qual FROM pg_policies WHERE tablename = '<affected_table>';
   -- Expect a policy using: tenant_id = current_setting('app.tenant_id', true)::uuid
   -- If qual is missing, wrong, or references the wrong column, that's the bug.
   ```
3. **Is `app_user` (the application's Postgres role) exempt from RLS by accident?**
   ```sql
   SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'estoque_app';
   -- Both must be false. Per ADR-002, only a separate migration/admin role should have BYPASSRLS.
   -- If estoque_app has rolbypassrls = true, THIS IS THE BUG — every RLS policy in the database
   -- is silently a no-op for the app's own connections. Fix: REVOKE, then re-verify all tables.
   ```
4. **Was `app.tenant_id` actually set for the request that leaked, or did it fall through to NULL?**
   - Per ADR-002 design, `current_setting('app.tenant_id', true)` returning NULL should fail CLOSED (no rows), not open — but this only holds if the Prisma `$extends` wrapper that calls `set_config` is actually invoked for the code path in question.
   - Check: does the affected route/job go through the standard Prisma client extension, or does it use a raw/unwrapped Prisma client, a direct `pg` connection, or a code path that bypasses the extension (e.g. a script, an admin tool, a newly-added job type)? **This is the single most likely root cause for a modular-monolith codebase — a new code path added outside the established data-access pattern.**
   - Check `set_config` scope: it must be called with `is_local = true` **inside the same transaction** as the subsequent query. If a connection pool or ORM detail causes the `set_config` and the query to run on different pooled connections (or in different transactions), the tenant context silently doesn't apply. Look for any place using `$queryRaw`/`$executeRaw` outside the wrapped `$transaction`.
5. **Is this the admin/`platform_admins` path?** `plans` and `platform_admins` are intentionally global (RLS disabled) per ADR-002. Confirm the leaked table isn't one of these two by design before treating it as a bug.
6. **Recent migrations:** check `schemas/migrations/` and Prisma migration history for any table created/altered near the time the leak started without a corresponding RLS policy migration.

## Fix and verify

1. Apply the fix (enable RLS, add/correct policy, revoke BYPASSRLS, fix the code path bypassing the Prisma extension — whichever root cause applied).
2. Re-run step 1 of Immediate Triage against the fix — confirm the previously-leaking query now returns zero rows (or correctly-scoped rows) under Tenant A's context.
3. Run the full ADR-002 automated RLS-coverage test suite, not just the one table — a single misconfigured table often means the checklist was skipped for a whole batch of related tables (e.g. everything added in the same PR/migration).
4. Grep the codebase for any other use of the same anti-pattern that caused this (e.g. other raw queries outside `$transaction`, other roles with BYPASSRLS).

## Post-incident (required, even for a 1-2 person team)

- Write down: what leaked, between which tenants, how many records, how long the exposure window was, and whether affected tenants need to be notified. Keep it short — a few paragraphs is enough — but keep it, since this is exactly the kind of incident a future audit or a customer's legal team may ask about.
- Add a regression test reproducing the specific root cause (not just "RLS is on") so this exact gap can't reopen silently.
- If the root cause was "a new code path bypassed the standard data-access pattern," consider whether a lint rule or code-review checklist item (Code Reviewer's domain) can catch this class of issue earlier next time — flag it as a finding, don't silently rely on remembering.
