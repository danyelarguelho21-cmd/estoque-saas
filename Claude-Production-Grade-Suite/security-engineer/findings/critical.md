# Critical Findings — Wave A Threat Model (estoque-saas)

Framing: these are DESIGN-level findings from a pre-implementation architecture review. Items marked **[GROUNDED IN CODE]** are demonstrated directly in scaffolding that already exists (SQL migration, docker-compose, `.env.example`, `libs/shared/*`); others are MUST-VERIFY checklist items for the Wave B code audit once Backend/Frontend Engineers finish BUILD. SLA per severity standard: fix within 24-48h of being confirmed against real code.

---

## C-1 — RLS enforcement is inert: single Postgres role is a superuser used by app, worker, and (implicitly) migrations [GROUNDED IN CODE]

**STRIDE:** Tampering, Information Disclosure
**Evidence:**
- `docker-compose.yml:6` — `POSTGRES_USER: estoque_app` (the official `postgres` image makes this the cluster's **superuser**/owner on first init).
- `docker-compose.yml:41` — `app` service `DATABASE_URL: postgresql://estoque_app:...` (same role).
- `docker-compose.yml:64` — `worker` service uses the identical `DATABASE_URL`/role.
- `.env.example:5` — `DATABASE_URL=postgresql://estoque_app:devpassword@localhost:5432/estoque_saas` — same pattern for local dev.
- Repo-wide grep for `CREATE ROLE`, `BYPASSRLS`, `GRANT`, `REVOKE` found **zero** executable SQL/infra statements — only doc comments in ADR-002 (`docs/architecture/architecture-decision-records/ADR-002-multi-tenancy-strategy.md:9`) promising a non-`BYPASSRLS` `app_user` separate from a migration-only privileged role.

**Why it matters:** PostgreSQL RLS policies are **never** applied to a superuser connection, and are not applied to a table's owning role unless `FORCE ROW LEVEL SECURITY` is also set (and even `FORCE` does not bind superusers). As currently configured, `estoque_app` is simultaneously: the role that owns every table (via migrations), the role the running Next.js app connects as, and the role the BullMQ worker connects as. Whether or not `withTenant()` correctly calls `set_config('app.tenant_id', ...)`, **every query sees every tenant's rows**, because RLS is not evaluated at all for this connection. This makes the BRD's explicit, non-negotiable requirement ("isolamento... reforçado em nível de banco... não apenas filtro de aplicação") false in practice, even if every Route Handler's application-level filtering is perfect.

**Required control:**
1. Create (in a migration or bootstrap script run by CI/deploy, not manually) at least two distinct roles:
   - A **migration/owner role** (`estoque_migrator` or similar) — owns all tables, used ONLY by `prisma migrate deploy` / CI, never present in the running app's `DATABASE_URL`.
   - A **runtime `app_user` role** — `NOSUPERUSER NOBYPASSRLS`, granted only the minimum `SELECT/INSERT/UPDATE/DELETE` needed on tenant tables and `SELECT/INSERT` (not `UPDATE/DELETE`) on `audit_log` (see C-2). This is the role the app and worker `DATABASE_URL` must use.
2. Apply `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on every tenant table as defense in depth, in case ownership is ever misconfigured again.
3. Update `docker-compose.yml`/`.env.example`/deployment docs so the app/worker `DATABASE_URL` can never accidentally point at the owner/superuser role.

**Wave B verification:** connect to the dev DB as the configured runtime role and run `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;` — both must be `false`. Then, without calling `withTenant()`, attempt a direct query against a tenant table and confirm it returns zero rows (or errors), not another tenant's data.

---

## C-2 — `audit_log` immutability GRANT/REVOKE is not applied — only a commented-out SQL line [GROUNDED IN CODE]

**STRIDE:** Repudiation, Tampering
**Evidence:** `schemas/migrations/0001_init.sql:346-348`:
```sql
-- audit_log: aplicação pode INSERT/SELECT, nunca UPDATE/DELETE (ADR-007).
-- Ajustar GRANTs conforme o usuário de aplicação criado no ambiente (ver docker-compose.yml / .env.example).
-- REVOKE UPDATE, DELETE ON audit_log FROM app_user;
```
The `REVOKE` is commented out. No other file in the repo grants/revokes privileges on `audit_log`. Combined with C-1 (no distinct `app_user` role exists at all yet), the audit log is fully `UPDATE`/`DELETE`-able by whatever role the app runs as — the exact opposite of ADR-007's "imutabilidade garantida pelo Postgres, não apenas por convenção de código" claim.

**Why it matters:** BRD Epic 8 requires an *immutable* audit trail. Without the DB-level `REVOKE`, "immutability" is currently only a code convention (no handler calls `UPDATE`/`DELETE` on `audit_log`) — trivially defeated by a bug, a future migration, an ad-hoc `psql` fix, or a compromised app process with a raw SQL injection elsewhere in the app. This also undermines the audit log's value as evidence in a billing dispute or an LGPD data-processing inquiry.

**Required control:**
1. Uncomment and actually execute the `REVOKE UPDATE, DELETE ON audit_log FROM app_user;` (or the final role name from C-1) as part of the migration pipeline, run by the migration/owner role — not the runtime role itself (a role cannot usefully revoke privileges from itself as the sole enforcement mechanism if it's also the owner).
2. Add a CI/QA check that connects as the runtime role and asserts `UPDATE`/`DELETE` on `audit_log` fails with a permission-denied error.
3. Track ADR-007's documented "future hardening" of trigger-level enforcement as a real backlog item (see Medium finding M-3) rather than leaving it purely aspirational — GRANT-based immutability protects existing rows from tampering, but does nothing for completeness (a mutation that never wrote an audit row can't be "tampered with" either, it's just silently missing).

**Wave B verification:** as runtime `app_user`, attempt `UPDATE audit_log SET action = 'create' WHERE id = '<any>'` and `DELETE FROM audit_log WHERE id = '<any>'` — both must fail with `permission denied for table audit_log`.

---

## C-3 — `product_store_settings` enabled for RLS but has no `tenant_id` column [GROUNDED IN CODE]

**STRIDE:** Tampering, Information Disclosure
**Evidence:**
- Table definition, `schemas/migrations/0001_init.sql:137-142`:
```sql
CREATE TABLE product_store_settings (
    product_id          uuid NOT NULL REFERENCES products(id),
    store_id            uuid NOT NULL REFERENCES stores(id),
    min_stock_override  integer,
    PRIMARY KEY (product_id, store_id)
);
```
No `tenant_id` column.
- The blanket RLS-enable loop, `schemas/migrations/0001_init.sql:317-344`, includes `'product_store_settings'` in the table array and (since it is not `'tenants'`) executes:
```sql
CREATE POLICY tenant_isolation ON product_store_settings USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
```

**Why it matters:** This migration **will fail at apply time** with `column "tenant_id" does not exist` — a blocking correctness bug the Backend Engineer must fix before the schema can even be deployed. It is flagged here (not just as a code-quality bug) because the *fix* is security-relevant: if a `tenant_id` column is bolted on later without care (no `NOT NULL`, no backfill, no FK, or populated via a join through `product_id`/`store_id` instead of stored directly), it creates exactly the RLS anti-pattern ADR-002 itself warns against in its "Alternatives Considered" section ("tabelas filhas... também precisam de `tenant_id` direto... para que a política RLS seja auto-contida"). A subquery-based or NULL-able `tenant_id` on this table would either break entirely or silently under-enforce.

**Required control:** Add `tenant_id uuid NOT NULL REFERENCES tenants(id)` directly to `product_store_settings`, populated at write time from the same request context as `product_id`/`store_id` (both of which are already tenant-scoped — validate they belong to the same tenant as the row being written, not just trust the FK). Re-run the migration end to end in CI to confirm it applies cleanly.

**Wave B verification:** confirm `schemas/migrations/0001_init.sql` (or its successor migration) applies without error in a clean database, and that `product_store_settings` has a direct, non-null, indexed `tenant_id` column with an active RLS policy.

---

## C-4 — PagBank webhook signature verification is an unimplemented stub — forged webhook can mark any invoice paid

**STRIDE:** Spoofing, Tampering
**Evidence:** `libs/shared/src/payments/providers/pagbank.ts:32-34`:
```ts
verifyWebhookSignature(_payload: string, _signature: string): boolean {
  throw new Error("TODO(BUILD): validar assinatura do webhook conforme documentação do PagBank");
}
```
`api/openapi/billing.yaml:92-106` correctly specifies `POST /api/webhooks/pagbank` with `security: []` (gateways can't send session cookies) and documents `401: Assinatura inválida — evento rejeitado` as the expected behavior once implemented — the **contract** is correct; the **implementation** does not exist yet.

**Attack (precise, see threat-model.md §3.1 for full detail):** An attacker POSTs a crafted JSON body matching the `charge.paid` shape (or PagBank's real webhook shape, if the handler parses it directly) to `/api/webhooks/pagbank` with no valid signature. If the eventual handler implementation checks only for the *presence* of a signature header, uses non-constant-time comparison, verifies against re-serialized JSON instead of the exact raw bytes PagBank signed, or simply forgets to call `verifyWebhookSignature()` before acting on the event, the forged event is accepted. Result: an unpaid tenant's invoice flips to `paid` and their subscription reactivates with zero payment — or, inversely, a targeted tenant's subscription is forged into `canceled`, an involuntary-suspension DoS.

**Required control (MUST-IMPLEMENT correctly, MUST-VERIFY at Wave B):**
1. Verify HMAC signature over the **exact raw request body bytes** PagBank sent — read the raw body before any JSON parsing/re-serialization (Next.js Route Handlers must not call a body-parsing helper that could alter byte-for-byte representation before signing verification runs).
2. Use `crypto.timingSafeEqual` (or equivalent constant-time compare), never `===`/`==` on the computed vs. provided signature/digest.
3. Verification must run and pass **before** `parseWebhookEvent()` or any state mutation.
4. `PAGBANK_WEBHOOK_SECRET` must have a boot-time non-empty assertion — the app should refuse to start (not silently accept-all) if the secret is blank/missing in a non-dev environment.
5. Re-verify PagBank's actual current signature scheme/header name via WebSearch at implementation time (Tier 2 freshness — API details change).
6. Confirm the existing `gateway_event_id UNIQUE` constraint (`0001_init.sql:93`) still guards idempotency once verification is real.

**Wave B verification:** send a request with a missing signature header → expect 401, zero DB mutation. Send a request with a tampered signature → expect 401. Send a request with a valid signature but already-processed `gateway_event_id` → expect idempotent no-op, not a duplicate charge/state change.

---

## C-5 — `fast-xml-parser` is not XXE-safe by default; no safe-parsing configuration specified

**STRIDE:** Information Disclosure, Denial of Service
**Evidence:** ADR-005 (`docs/architecture/architecture-decision-records/ADR-005-nfe-xml-import.md:6`) and `docs/architecture/tech-stack.md:19` both specify `fast-xml-parser` (`latest`, no version floor, no parser options documented). WebSearch (2026-09, freshness-protocol Tier 1 for a live parsing library's default security posture) confirms: *"XXE protection requires explicit configuration rather than being secure by default"* — the safe configuration requires explicitly setting `processEntities: false` (and related options) on the `XMLParser` instance. WebSearch also surfaced **CVE-2026-25896** (CVSS 9.3, entity-encoding bypass in `fast-xml-parser` → XSS/injection when parsed output reaches HTML/SQL/other contexts), fixed in **5.3.5** (Feb 2026).

**Why it matters:** NF-e XML uploads are attacker-influenced input — any authenticated operador can upload an arbitrary XML file claiming to be a "supplier invoice." Item fields (`xProd`, `cProd`) parsed from that file are persisted (`nfe_import_items`) and rendered in the conferência UI. Without explicit safe-parsing configuration, a crafted `<!DOCTYPE>`/external-entity payload could enable SSRF or local file disclosure via the worker process; without a patched library version, the disclosed CVE's injection path is separately reachable.

**Required control:**
1. Pin `fast-xml-parser` to `>=5.3.5` (re-verify current patched version at BUILD time).
2. Explicitly construct the parser with entity/DOCTYPE processing disabled (`processEntities: false` and any related hardening options current at BUILD time).
3. Reject any uploaded file containing a `<!DOCTYPE` declaration before it reaches the parser at all (legitimate SEFAZ `nfeProc`/`procNFe` XML never contains one) — defense in depth beyond parser config.
4. Confirm downstream rendering of `xProd`/`cProd` in the Frontend Engineer's conferência screen never uses `dangerouslySetInnerHTML` or an equivalent unescaped sink.

**Wave B verification:** feed a test XML containing a `<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>` payload through the actual import pipeline and confirm it is rejected (not parsed, not reflected) before reaching the parser or, if reaching it, that no entity expansion occurs.
