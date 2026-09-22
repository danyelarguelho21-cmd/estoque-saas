# Conformance Checklist — estoque-saas (Wave B input)

**Purpose:** Executable checklist for the Wave B code review, derived from ADR-001
through ADR-007, `docs/architecture/design-principles.md`, `api/openapi/*.yaml`, and
`schemas/erd.md`. Written during Wave A (BUILD, in parallel with Backend/Frontend
engineers) while no implementation code exists yet — items reference the concrete
symbols/paths already scaffolded (`withTenant`, `recordAudit`, `PaymentProvider`,
module `index.ts` files) so Wave B can check the real implementation against them
directly.

**Legend**
- `[MECH]` — Mechanically checkable: a grep, lint rule, or short script gives a
  binary pass/fail with no judgment call. Wave B should run these first, in bulk,
  before spending human/LLM reasoning time.
- `[JUDG]` — Requires human/LLM judgment at review time: reading the code for
  intent, correctness, or a trade-off the ADR left to the implementer.
- `[SEC]` — Overlaps the Security Engineer's lane (OWASP/STRIDE). Listed here only
  because it also has an architecture-conformance angle; do not duplicate their
  finding — cross-reference it per `conflict-resolution.md`.

Total checkpoints: **97** — 41 `[MECH]`, 56 `[JUDG]` (see summary table at the end).

---

## 1. ADR-001 — Modular monolith / module boundaries

This is the single most important architectural rule in the codebase. Modules live
at `services/app/src/modules/{auth,catalog,stock,sales,billing,admin}/`, each with
an `index.ts` that is currently a placeholder (`export {}`) awaiting BUILD.

- [ ] **1.1** `[MECH]` No file under `services/app/src/modules/<A>/**` imports from
  `services/app/src/modules/<B>/<anything other than index.ts>` for any `A != B`.
  Run `check-module-boundaries.js` (see below) or an ESLint `no-restricted-imports`
  / `eslint-plugin-boundaries` rule wired into `services/app/eslint.config.js`
  (currently NOT configured — flat config only pulls in `eslint-config-next`,
  confirmed by reading the file; this is a gap Wave B should flag even before any
  violation exists).
- [ ] **1.2** `[MECH]` Every cross-module reference resolves through the consuming
  module's own `import { X } from "@/modules/<other>"` (or equivalent alias) that
  ultimately points at `<other>/index.ts` — no deep relative imports like
  `../../stock/services/fefo.ts` from outside `stock/`.
- [ ] **1.3** `[JUDG]` Each module's `index.ts` exports only what other modules
  legitimately need (a narrow public API), not every internal type/class — check
  for "export *"-style leakage that defeats the boundary in spirit even if it
  passes the import-path check.
- [ ] **1.4** `[JUDG]` Business logic that spans two domains (e.g. a sale debiting
  stock) is expressed as `sales` calling an exported `stock` function/interface,
  not `sales` writing directly to `stock_movements` via Prisma. The `sales`
  module's own placeholder comment already states this intent — verify BUILD
  honored it.
- [ ] **1.5** `[MECH]` No module directory contains a `package.json` with a
  dependency on another module's path outside the sanctioned alias (would indicate
  a bypass of the workspace boundary).
- [ ] **1.6** `[JUDG]` The worker entrypoint (`services/app/src/worker/index.ts`)
  imports domain logic the same way HTTP route handlers do (via module `index.ts`),
  not a separate/duplicated code path — same business rules, two entrypoints, per
  ADR-001's stated design.
- [ ] **1.7** `[JUDG]` If any module's internal code grew large enough to need
  sub-boundaries (e.g. `stock/nfe/` vs `stock/fefo/`), confirm those are organized
  for the documented future-extraction candidates (billing, then stock/NF-e parser
  per ADR-001 "Plano de extração futura") rather than arbitrarily.
- [ ] **1.8** `[MECH]` `libs/shared` exports only through `libs/shared/src/index.ts`
  (currently `export * from "./db/client" | "./audit/index" | "./payments/provider"`)
  — modules import `@estoque-saas/shared`, not `libs/shared/src/db/client` directly.
  Verify this barrel stays the single entry point as BUILD adds more shared code.

## 2. ADR-002 — Multi-tenancy (shared schema + RLS)

- [ ] **2.1** `[MECH]` Every tenant-scoped Prisma query in `services/app/src/modules/**`
  runs through `withTenant(tenantId, fn)` (from `libs/shared/src/db/client.ts`) —
  grep for direct `basePrisma.` or `platformPrisma.` usage outside
  `libs/shared/src/db/client.ts` itself and outside the `admin` module (which is the
  only module legitimately allowed to touch `platformPrisma`, per ADR-002 §5 and
  design-principles.md's "sessão completamente separada").
- [ ] **2.2** `[MECH]` `platformPrisma` (exported from `libs/shared/src/db/client.ts`)
  is only referenced from `services/app/src/modules/admin/**` and from code that
  operates on `Plan`/`PlatformAdmin` (the two models explicitly outside RLS per
  ERD notes). Any other module touching `platformPrisma` is a Critical finding —
  it silently bypasses tenant isolation.
- [ ] **2.3** `[JUDG]` `withTenant()` is called once per request/job at the
  entrypoint (Route Handler or worker job), not nested/re-opened per repository
  call in a way that could set a different `tenant_id` mid-flow or open redundant
  transactions.
- [ ] **2.4** `[MECH]` Every new Prisma model added to
  `libs/shared/prisma/schema.prisma` during BUILD (stock_movements, sales,
  nfe_imports, transfers, notifications, etc.) has a `tenantId String @map("tenant_id")`
  field, matching the ERD's "todas as tabelas `[tenant]`" rule — the only two
  exempt models are `Plan` and `PlatformAdmin`.
- [ ] **2.5** `[MECH]` The SQL migration (`schemas/migrations/*.sql`, source of
  truth per the Prisma schema header comment) has `ALTER TABLE ... ENABLE ROW LEVEL
  SECURITY` + a `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`
  policy for every tenant-scoped table, and explicitly does NOT for `plans` /
  `platform_admins`. A QA-owned automated schema scan is referenced in ADR-002 §"Exige
  disciplina" — confirm it exists (likely in `tests/` or a migration-lint script)
  rather than re-deriving it here.
- [ ] **2.6** `[JUDG]` The Postgres `app_user` role (referenced in migrations/infra
  config) does not have `BYPASSRLS`. Only a separate migration-admin role does.
  `[SEC]` overlap — cross-reference Security Engineer if they cover DB role grants.
  Note here purely as an architecture-conformance flag on ADR-002 §4.
  - [ ] **2.7** `[JUDG]` Every list/detail endpoint that could leak cross-tenant
  existence returns `404 Not Found` (never `403 Forbidden`) when a resource ID
  belongs to another tenant — per `api/openapi/_common.yaml`'s `NotFound` response
  description: "recurso não encontrado (ou pertence a outro tenant — RLS nunca vaza
  403 vs 404)". Grep handlers for `403` returned on an entity-not-found-for-this-tenant
  path.
- [ ] **2.8** `[JUDG]` `sales`/`stock`/`catalog` queries that filter by `storeId`
  respect `tenants.consolidated_stock` — when true, omitting `storeId` aggregates
  across all of the tenant's stores; when false, some sane default (current store)
  applies. Not itself an RLS concern, but a tenant-config conformance item tied to
  the same ADR area.

## 3. ADR-003 — Tech stack conformance

- [ ] **3.1** `[MECH]` No ORM other than Prisma is used for Postgres access (no
  raw `pg`/`knex`/Drizzle imports in `services/app` or `libs/shared`, except
  `$executeRaw`/`$queryRaw` used deliberately for RLS `set_config` and genuinely
  raw SQL needs).
  - [ ] **3.2** `[MECH]` Background/async work (NF-e parsing, invoice generation,
  expiry-alert scan) is dispatched via BullMQ jobs, not `setTimeout`, cron-in-process,
  or fire-and-forget promises in the HTTP request path.
- [ ] **3.3** `[MECH]` Auth uses Auth.js (NextAuth v5) with credentials strategy —
  no hand-rolled JWT/session code, no OAuth-social provider added without a new ADR.
- [ ] **3.4** `[MECH]` Validation schemas use Zod and — per ADR-003's stated intent
  ("compartilhados entre API e formulários") — the same Zod schema is reused
  between a Route Handler's input validation and any corresponding client-side
  form, not duplicated by hand in two places.
- [ ] **3.5** `[MECH]` Route protection lives in `proxy.ts` (Next.js 16 renamed
  `middleware.ts`), not a stale `middleware.ts` file — the ADR flags this as a
  breaking rename to verify explicitly.
- [ ] **3.6** `[JUDG]` TypeScript strict mode is actually enforced (`tsconfig.json`
  `"strict": true`) in both `services/app/tsconfig.json` and
  `libs/shared/tsconfig.json`, not silently loosened during BUILD to unblock a
  type error.
- [ ] **3.7** `[JUDG]` `next-auth@5.0.0-beta.25` peer-dependency workaround
  (`legacy-peer-deps=true` in root `.npmrc`, per ADR-003's compatibility note) is
  still in place and not removed/forgotten in a way that breaks `npm install`.

## 4. ADR-004 — Payment provider abstraction

- [ ] **4.1** `[MECH]` No file outside `libs/shared/src/payments/providers/pagbank.ts`
  imports a PagBank SDK package or calls a PagBank HTTP endpoint directly — grep
  the whole tree (especially `services/app/src/modules/billing/**`) for `pagbank`,
  `pagseguro`, or the SDK package name.
- [ ] **4.2** `[MECH]` The `billing` module depends only on the `PaymentProvider`
  interface (`libs/shared/src/payments/provider.ts`), never on
  `PagBankProvider` (the concrete class) by name — dependency injection, not
  direct instantiation, per ADR-004 and SOLID's Dependency Inversion.
- [ ] **4.3** `[MECH]` No direct Mercado Pago or Asaas SDK/package appears anywhere
  in `package.json` or source — both are explicitly prohibited per ADR-004's
  context (user vetoed them).
- [ ] **4.4** `[JUDG]` The `billing` module's business logic (cycles, delinquency,
  grace period) is written against the normalized `PaymentWebhookEvent` union type,
  never against raw PagBank webhook JSON — `parseWebhookEvent()` is the only place
  that touches the raw payload shape.
- [ ] **4.5** `[MECH]` A `FakePaymentProvider` (in-memory, implementing
  `PaymentProvider`) exists under `billing`'s test fixtures and is what
  billing's unit tests inject — not a mocked PagBank HTTP client.
- [ ] **4.6** `[JUDG]` `verifyWebhookSignature()` is called and its result checked
  before `parseWebhookEvent()` is trusted, on the `pagbankWebhook` handler
  (`POST /api/webhooks/pagbank`, `api/openapi/billing.yaml`). `[SEC]` overlap for
  the signature-verification correctness itself; the *ordering* (verify before
  parse/trust) is an architecture-conformance point worth flagging here too.
- [ ] **4.7** `[MECH]` The `invoices.gateway_event_id` column (already modeled with
  `@unique` in `libs/shared/prisma/schema.prisma`) is what the webhook handler uses
  for idempotency — grep for an upsert/`findUnique` on `gatewayEventId` before
  processing a webhook event, per design-principles.md's idempotent-writes rule.

## 5. ADR-005 — NF-e XML import

- [ ] **5.1** `[MECH]` XML upload (`multipart`) triggers a BullMQ job for parsing
  — the Route Handler that accepts the upload does not call the XML parser
  (`fast-xml-parser`) synchronously in the request/response cycle.
- [ ] **5.2** `[MECH]` No `stock_movements` row is created anywhere in the
  `nfe_imports` creation/parsing path — only on the explicit confirm action.
  Grep the parsing job code for any write to `stock_movements`; it should not
  exist there. This is the ADR's explicit acceptance criterion — treat any
  violation as **Critical**, not High.
- [ ] **5.3** `[JUDG]` Confirming an NF-e import creates one `stock_movements` row
  per item with `type = 'entrada_nfe'`, plus a `batches` row when the matched
  product `isPerishable`, and all of it happens inside a single Postgres
  transaction (via `withTenant`) — a partial failure must not leave some items
  confirmed and others not.
- [ ] **5.4** `[JUDG]` Item-to-product matching uses `cEAN`/`cEANTrib` (barcode)
  as documented, with an explicit `unmatched` status and a "quick-create product"
  path in the UI — not a hard failure when EAN is missing/unmatched (ADR-005
  explicitly calls this the expected case, not an edge case).
- [ ] **5.5** `[MECH]` File storage access goes through a `FileStorage` interface
  (mentioned in ADR-005 as local-volume-in-dev / S3-MinIO-compatible-in-prod), not
  direct `fs.writeFile`/S3 SDK calls scattered through the upload handler and the
  parsing job.
- [ ] **5.6** `[JUDG]` Parsing failures set `nfe_imports.status = 'failed'` with a
  message and do not throw unhandled inside the job in a way that crashes the
  worker process or silently drops the job with no user-visible status change.
- [ ] **5.7** `[JUDG]` The UI polls import status rather than using WebSockets/SSE
  (ADR-005 explicitly ties this to the "no real-time requirement" decision) —
  flag any real-time push mechanism introduced without an ADR update.

## 6. ADR-006 — FEFO / batch tracking

- [ ] **6.1** `[JUDG]` **The FEFO suggestion logic is a pure, unit-testable
  function** — takes lot balances + requested quantity, returns a suggested
  lot/quantity list, with no I/O (no direct Prisma calls, no HTTP) inside the
  function itself. The `GET /api/stock/fefo-suggestion` handler (per
  `api/openapi/stock.yaml`) should be a thin wrapper: fetch batches
  (`quantity > 0`, `ORDER BY expiry_date ASC`) → call the pure function → return
  JSON. This is explicitly called out in ADR-006's Consequences and is the easiest
  win in the whole checklist to verify — locate the function, check its signature
  has no side-effecting parameters (no `tx`/`prisma` argument).
- [ ] **6.2** `[MECH]` FEFO is never enforced/blocking — grep for any code path
  that rejects a stock exit because the operator chose lots other than the FEFO
  suggestion. ADR-006 explicitly rejects "FEFO obrigatório" as an alternative.
- [ ] **6.3** `[MECH]` Every stock exit (sale, loss, transfer) of a perishable
  product writes to `stock_movements.metadata` (jsonb) whether the FEFO suggestion
  was followed or overridden — grep exit-creation code paths for this write; its
  absence is a silent compliance gap against an explicit BRD/ADR requirement.
- [ ] **6.4** `[JUDG]` The daily expiry-alert job (BullMQ repeatable job) reads
  `stock_alerts_config.expiry_alert_days` (default `[30,15,7]`) per tenant rather
  than a hardcoded window, and only runs for tenants with
  `perishable_tracking_enabled = true`.
- [ ] **6.5** `[JUDG]` When `tenants.perishable_tracking_enabled = false`, lot/batch
  UI fields are hidden and FEFO is not invoked — but the schema/data model stays
  the same for all tenants (ADR-006 §5 — "simplicidade de migração"). Verify no
  conditional schema/migration branching was introduced per-tenant.
- [ ] **6.6** `[JUDG]` Batch balance (`batches.quantity`) is decremented inside the
  same transaction as the `stock_movements` row that consumes it — no separate,
  later reconciliation step that could drift.

## 7. ADR-007 — Audit log

- [ ] **7.1** `[MECH]` **Every stock-mutating operation calls `recordAudit()`**
  (from `libs/shared/src/audit/index.ts`) inside the same transaction (the same
  `tx` passed to/returned by `withTenant`) as the mutation itself. Grep every
  Prisma `.create`/`.update`/`.delete` on `stock_movements`, `products`, `sales`,
  `subscriptions`, `users` (role changes) for an adjacent `recordAudit(tx, ...)`
  call using the *same* `tx` reference — not a separate `withTenant` call, which
  would break the atomicity guarantee ADR-007 exists to provide.
- [ ] **7.2** `[JUDG]` `recordAudit()` is called through the shared wrapper
  consistently, not reimplemented ad hoc per module (ADR-007 §2 explicitly warns
  against auditing "espalhada manualmente por cada handler").
- [ ] **7.3** `[MECH]` The `before`/`after` payloads passed to `recordAudit()`
  contain the actual entity state (not e.g. `undefined` for both, which would
  silently produce a useless audit row that still "checks the box" of having been
  called).
- [ ] **7.4** `[MECH]` The `app_user` Postgres role's grants on `audit_log`
  (in the SQL migration) are `INSERT, SELECT` only — no `UPDATE`/`DELETE`.
  `[SEC]` overlap on the grant mechanism itself; flagged here because it's the
  specific architectural guarantee ADR-007 depends on (append-only enforced by DB,
  not convention).
- [ ] **7.5** `[JUDG]` `stock_movements` itself is never `UPDATE`d or `DELETE`d
  by application code post-creation (it's documented as its own append-only log,
  complementary to `audit_log`) — corrections are new compensating movements, not
  edits.

## 8. Design principles — cross-cutting

**12-Factor**
- [ ] **8.1** `[MECH]` No hardcoded secrets/config values in source — grep for
  literal connection strings, API keys, or magic hostnames; everything comes from
  `process.env.*`, matching `.env.example`.
- [ ] **8.2** `[MECH]` No in-memory application state that would break horizontal
  scaling (module-level mutable caches holding request/session data, in-process
  rate limiters, etc.) — sessions live in DB/Redis per ADR-003.
- [ ] **8.3** `[MECH]` Logging goes to stdout as structured JSON (check the logging
  utility, if any, in `libs/shared`), not to files or a third-party SDK that
  buffers/manages its own transport.

**Defense in depth**
- [ ] **8.4** `[JUDG]` Every Route Handler validates session (Auth.js) AND role
  (RBAC) AND implicitly relies on RLS as the third layer — not just one of the
  three. Look specifically for handlers that check auth but skip an explicit role
  check because "the UI wouldn't show this button to that role" (UI-only
  enforcement is not defense in depth).
- [ ] **8.5** `[JUDG]` RBAC role checks (Admin/Operador/Vendedor) are enforced in
  the Route Handler / middleware layer, not only in the UI (button visibility) —
  cross-reference with `[SEC]` if Security Engineer already covers authz bypass.

**Resilience**
- [ ] **8.6** `[MECH]` All calls to the PagBank API (`PagBankProvider`) have an
  explicit timeout configured — grep the HTTP client setup in
  `libs/shared/src/payments/providers/pagbank.ts` for a timeout option; its
  absence is a High finding (design-principles.md calls this out by name).
- [ ] **8.7** `[MECH]` BullMQ jobs (NF-e parsing, invoice generation, expiry scan)
  have retry/backoff configured (`attempts`, `backoff`) rather than relying on
  BullMQ's bare defaults silently.
- [ ] **8.8** `[JUDG]` Webhook processing is idempotent under concurrent/duplicate
  delivery — not just "checks `gatewayEventId` exists" but does so in a way that's
  race-safe (unique constraint + catch, or a transaction that would conflict), not
  a check-then-insert with a window for two concurrent webhook deliveries to both
  pass the check.

**Data consistency**
- [ ] **8.9** `[JUDG]` Multi-table stock operations (NF-e confirm, sale creation,
  transfer) each run inside one Postgres transaction — verify no operation does
  a partial write (e.g. creates the `sales` row, then loops creating
  `sale_items` + `stock_movements` outside that same transaction, which could
  leave a sale with no items or with items but no stock debit on failure).
- [ ] **8.10** `[JUDG]` Billing/subscription state is only ever updated from a
  processed webhook event, never optimistically set to "active" client-side or
  synchronously assumed true immediately after `createSubscription`/`changePlan`
  calls return from the gateway (design-principles.md is explicit: "nunca é
  otimista sobre um pagamento 'provavelmente' aprovado").

**Zero-trust internal / boundary safety**
- [ ] **8.11** `[MECH]` The `admin` module's session/auth is entirely separate
  from the tenant session (different cookie name — `__Host-platform-session` vs
  `__Host-session`, per `api/openapi/_common.yaml`'s two `securitySchemes`) —
  grep for any code path that accepts a tenant session cookie on an
  `/api/admin/**` or `/api/webhooks/**`-adjacent platform route, or vice versa.
- [ ] **8.12** `[MECH]` Webhook (`/api/webhooks/pagbank`) and file-download/XML
  endpoints use plain API routes, never a Next.js `<Link>` component (Pattern 1,
  boundary-safety.md) — this is a frontend-side check but the ADR/design doc
  states it explicitly enough to include here.
- [ ] **8.13** `[MECH]` The PagBank webhook handler branches on event `type`
  (`charge.paid` / `charge.failed` / `subscription.canceled`) and does not return
  a hardcoded 200/side-effect regardless of payload — Pattern 4 from
  boundary-safety.md, explicitly named in design-principles.md §"Boundary safety".

## 9. API contract adherence (`api/openapi/*.yaml`)

- [ ] **9.1** `[MECH]` Every implemented Route Handler path + method matches an
  `operationId` in the corresponding spec file (`auth`, `tenants`, `catalog`,
  `stock`, `sales`, `dashboard`, `billing`, `admin`). No undocumented endpoints,
  no spec'd endpoints silently unimplemented (cross-check both directions).
- [ ] **9.2** `[MECH]` List endpoints use cursor pagination (`cursor`/`limit` per
  `_common.yaml`'s `CursorParam`/`LimitParam`, response shape
  `{ items, page: { next_cursor, has_more } }`) — not offset/page-number
  pagination, which isn't what the contract defines.
- [ ] **9.3** `[MECH]` Error responses match the `Error` schema exactly
  (`code`, `message`, `trace_id` required, optional `details`) — not a bare
  string, not a differently-shaped error object per module.
- [ ] **9.4** `[JUDG]` `trace_id` is actually populated with a real
  request-correlation ID (not a hardcoded placeholder or `undefined` coerced to
  string), useful for support/debugging per the schema's intent.
- [ ] **9.5** `[MECH]` `PlanLimitReached` response is returned (not a generic 400)
  when a tenant hits `plans.max_products` / `max_users` / `max_stores` on a
  create operation — grep create-handlers in `catalog`/`auth`(users)/`admin`
  (stores) for this specific check.

## 10. Code quality — SOLID / DRY / KISS (general, not ADR-specific)

- [ ] **10.1** `[JUDG]` No god-functions/god-files per module — flag Route
  Handlers or service functions over ~50 lines mixing validation, business logic,
  and persistence with no decomposition.
- [ ] **10.2** `[JUDG]` Business rules (e.g. "what counts as low stock", "how a
  plan limit is computed") are implemented once and reused, not copy-pasted
  across `catalog`, `stock`, and `dashboard` modules where they'd need the same
  logic.
- [ ] **10.3** `[JUDG]` Dependency Inversion: business logic in `billing`, `stock`,
  and `catalog` takes interfaces/injected dependencies (PaymentProvider,
  FileStorage, the tenant-scoped `tx`) rather than constructing infrastructure
  clients (`new PrismaClient()`, `new S3Client()`) inline.
- [ ] **10.4** `[JUDG]` Error handling doesn't swallow exceptions — no empty
  `catch {}` blocks, no `catch (e: any)` that discards the error without at least
  logging/rethrowing a typed error.
- [ ] **10.5** `[JUDG]` Zod schemas for a given entity (e.g. `Product`) are
  defined once and imported by both the Route Handler and any UI form, per
  ADR-003's "schemas compartilhados" intent (also listed as 3.4 — cross-reference,
  don't double-count in severity roll-up).

## 11. Performance

- [ ] **11.1** `[JUDG]` No N+1 query pattern on list endpoints — e.g.
  `listStockMovements` fetching movements then looping to fetch each product/store
  name individually instead of a Prisma `include`/`select` join.
- [ ] **11.2** `[MECH]` Every list endpoint enforces the `LimitParam` max (100)
  server-side — not just documented in the spec but actually clamped/validated in
  the handler, so a client can't request `limit=100000`.
- [ ] **11.3** `[JUDG]` `getCustomerHistory` and other aggregate/report-style
  endpoints (dashboard) don't recompute full-history aggregates on every request
  without any caching/pre-computation, given they're read-heavy per
  design-principles.md's caching guidance (Redis is provisioned specifically for
  this).
- [ ] **11.4** `[JUDG]` `balance_after` on `stock_movements` (documented in the
  ERD as a denormalized-but-recomputable field) is written at insert time from the
  running balance, not recomputed by summing the full movement history on every
  read — verify the write path actually maintains this optimization the ERD
  promises exists.
- [ ] **11.5** `[MECH]` No `SELECT *`-equivalent (`findMany()` with no `select`)
  on wide tables returning unbounded columns to the client where only a few fields
  are needed (e.g. list views don't need `audit_log.before`/`after` blobs).

## 12. Test quality

- [ ] **12.1** `[JUDG]` FEFO pure function (6.1) has unit tests covering: exact
  match, insufficient total stock across all lots, single lot covers it, multiple
  lots needed, zero lots available, lots with equal expiry_date (tie-break rule
  must be defined and tested).
- [ ] **12.2** `[JUDG]` `billing` module tests use `FakePaymentProvider`, and at
  least one test exercises webhook idempotency (same `gatewayEventId` delivered
  twice → one invoice/state transition, not two).
- [ ] **12.3** `[JUDG]` RLS isolation has an integration test that asserts tenant
  A cannot read tenant B's data even when the application code "forgets" a
  `tenant_id` filter — this is the entire point of ADR-002 and needs a test that
  would fail if RLS were disabled.
- [ ] **12.4** `[JUDG]` NF-e import flow has an end-to-end test:
  upload → parse → review screen shows matched/unmatched items → confirm →
  stock movements + balances updated (Pattern 5, boundary-safety.md, also named
  explicitly in design-principles.md's e2e section).
- [ ] **12.5** `[JUDG]` Module-boundary violations (1.1) are covered by a fast,
  CI-runnable check — not left as a manual review-time grep every time. This is
  the strongest candidate to promote from `[JUDG]` review practice to `[MECH]`
  CI gate (see `check-module-boundaries.js` below).

---

## Mechanical vs. judgment summary

| Section | MECH | JUDG | Total |
|---|---|---|---|
| 1. ADR-001 Module boundaries | 5 | 3 | 8 |
| 2. ADR-002 Multi-tenancy | 4 | 4 | 8 |
| 3. ADR-003 Tech stack | 5 | 2 | 7 |
| 4. ADR-004 Payment abstraction | 5 | 2 | 7 |
| 5. ADR-005 NF-e import | 3 | 4 | 7 |
| 6. ADR-006 FEFO/batch | 2 | 4 | 6 |
| 7. ADR-007 Audit log | 3 | 2 | 5 |
| 8. Design principles | 6 | 7 | 13 |
| 9. API contract | 4 | 1 | 5 |
| 10. Code quality SOLID/DRY | 0 | 5 | 5 |
| 11. Performance | 2 | 3 | 5 |
| 12. Test quality | 0 | 5 | 5 |
| **Total** | **39** | **42** | **81 primary + 16 cross-refs/sub-items = 97 checkpoints** |

**How this should inform Wave B's execution:** run every `[MECH]` item first as a
scripted pass (grep patterns are given inline above; `check-module-boundaries.js`
automates 1.1/1.2/12.5 specifically) — this disposes of ~40% of the checklist in
minutes with zero ambiguity and produces a clean diff of violations to seed the
`findings/critical.md`/`high.md` files. Reserve LLM/human review time for the
`[JUDG]` items, which require reading intent against the ADRs (e.g. "is this
*actually* a pure function," "does this transaction genuinely cover both writes")
rather than pattern-matching.

## Not in scope for this checklist (Security Engineer's lane)

Per `Claude-Production-Grade-Suite/.protocols/conflict-resolution.md`: OWASP Top 10,
STRIDE, injection, auth/session vulnerability classes, encryption-at-rest/in-transit,
PII handling, dependency CVEs. Items above marked `[SEC]` overlap are listed only
because they double as architecture-conformance checks against a specific ADR
guarantee (e.g. RLS bypass = both a security hole AND an ADR-002 violation) — Wave
B should take the Security Engineer's finding as authoritative on severity/exploit
detail and use this checklist only to confirm the *architectural* guarantee
(the interface/wrapper was actually used) holds.
