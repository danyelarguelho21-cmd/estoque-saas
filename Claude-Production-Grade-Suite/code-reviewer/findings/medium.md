# Medium Findings — Wave B Code Review (estoque-saas)

---

### [ME-1] `getCustomerHistory` is unbounded — both the handler and the API contract itself lack pagination

**Severity:** Medium
**Category:** Performance / Architecture Conformance (API contract inconsistency)
**Location:**
- `services/app/src/modules/sales/customers.ts:41-45` (`getCustomerHistory`)
- `api/openapi/sales.yaml:94-108` (`GET /api/customers/{customerId}/history`)

**Description:** `tx.sale.findMany({ where: { customerId }, include: { items: true }, orderBy: { createdAt: "desc" } })`
has no `take`/cursor — it returns the customer's **entire** purchase history, with every sale's
line items nested, in one response. Unlike every other list-shaped endpoint in the same spec file
(`listSales`, `listStockMovements`, `listCustomers`, ...), the OpenAPI contract for this one
(`api/openapi/sales.yaml:102-108`) documents the response as a bare `type: array`, not the
`{ items, page: { next_cursor, has_more } }` shape `_common.yaml`'s `CursorParam`/`LimitParam`
convention defines elsewhere — so this isn't just a handler oversight, the contract itself never
asked for pagination here. For a long-tenured repeat customer this is an unbounded response size
that will only grow over the business's lifetime.

**Impact:** Slow/large responses for the endpoint's core use case (a customer with a long
purchase history is exactly the case where "see their history" gets called most).

**Recommendation:** Add `cursor`/`limit` to both the OpenAPI operation and the handler, consistent
with every sibling list endpoint. Flagging the contract gap specifically because the fix belongs
in `api/openapi/sales.yaml` (Solution Architect's artifact), not just the handler — a
handler-only fix would still leave the documented contract wrong.

---

### [ME-2] CSV product import: any row-level error rolls back the entire file, contradicting the code's own "best-effort per row" comment

**Severity:** Medium
**Category:** Code Quality (implementation doesn't match its own documented contract)
**Location:** `services/app/src/modules/catalog/csv-import.ts:8-40` (`processProductsCsvJob`)

**Description:** The function's header comment states: *"Best-effort por linha: SKUs
duplicados/erros de uma linha não abortam o restante do arquivo — cada linha é uma tentativa
independente de createProduct"* (best-effort per row: duplicate SKUs/row errors don't abort the
rest of the file). The code only actually honors this for the one case it explicitly pre-checks
(`sku` already exists → `skipped++; continue`). The entire loop runs inside a single
`withTenant(tenantId, async (tx) => { for (...) { ... await tx.product.create(...) ... } })`
transaction. Any **other** row-level failure `tx.product.create` can throw — a barcode uniqueness
violation, an invalid `categoryId`/`supplierId` foreign key, a value that fails a DB-level check
constraint the pre-check doesn't cover — propagates out of the callback and rolls back the
**entire transaction**, silently discarding every product already created earlier in the same
file, not just skipping the one bad row as documented.

**Impact:** Not a data-corruption bug (the rollback is atomically safe), but a functional
contradiction: a CSV with 500 valid rows and 1 row with an invalid `categoryId` on row 500
imports **zero** products, when the documented (and presumably BRD-expected) behavior is 499
created + 1 reported as failed. Silent from the caller's perspective too — the function's return
shape (`{ created, skipped }`) has no field for "errored," so even a caller inspecting the result
wouldn't learn a mid-file exception occurred versus the file genuinely having zero new SKUs.

**Recommendation:** Wrap each row's `create` in its own try/catch (or a Prisma
`SAVEPOINT`/nested-transaction equivalent) inside the outer transaction, capture per-row errors
into a third return field (e.g. `errors: Array<{ row: number; message: string }>`), and only let
genuinely unexpected/infrastructure errors (not per-row validation failures) abort the whole job.

---

### [ME-3] `csv-import` and the daily `scan-expiry-alerts` job hold one long transaction for the entire per-tenant/per-file work

**Severity:** Medium
**Category:** Performance / Reliability
**Location:**
- `services/app/src/modules/catalog/csv-import.ts:13-37` — one `withTenant` wraps every row of
  the uploaded file.
- `services/app/src/modules/stock/expiry-scan.ts:36-75` (`scanOneTenant`) — one `withTenant`
  wraps the batch-expiry scan AND the full low-stock scan (itself the N+1 loop in HI-1) for the
  entire tenant's catalog, run once per tenant per day from `scanExpiryAndLowStockAlerts`
  (`expiry-scan.ts:13-22`), sequentially across all active tenants.

**Description:** Both hold a single Postgres transaction open for the full duration of a
potentially large, slow, loop-driven operation (hundreds/thousands of CSV rows; a full product
catalog scan). Long-held transactions hold row/table locks and an MVCC snapshot for their entire
duration, increasing lock contention with concurrent operators (a CSV import running while
someone else is registering a sale on the same product) and reducing the vacuum's ability to
reclaim dead tuples platform-wide for as long as the transaction is open.

**Recommendation:** For `csv-import`, batch commits every N rows (e.g. 100) instead of one
transaction for the whole file. For `expiry-scan`, this compounds directly with HI-1's fix — once
the per-product loop becomes one batched query, the transaction's duration drops from
O(catalog size) round-trips to a handful, which likely resolves this finding as a side effect;
call this out explicitly if HI-1 is fixed first so this isn't independently re-flagged.

---

### [ME-4] Module-level `new Queue(...)` in two Route Handler files, each with its own Redis connection, never explicitly closed

**Severity:** Medium
**Category:** Code Quality (Resource Management)
**Location:**
- `services/app/src/app/api/nfe-imports/route.ts:7` — `const parseNfeQueue = new Queue(...)`
- `services/app/src/app/api/products/import/route.ts:6` — `const importQueue = new Queue(...)`

**Description:** Both files instantiate a BullMQ `Queue` (which opens its own ioredis connection)
at **module load time**, module-scope, outside any handler function. In a standard long-running
Node server this is fine (module loads once, one connection persists for the process lifetime) —
but Next.js Route Handlers can be bundled/instantiated per-route-module in ways that aren't always
a single persistent process (and the project's own `worker/index.ts` separately instantiates two
more `Queue`s for the repeatable jobs, `worker/index.ts:71,78`, each module-scoped the same way).
None of the four `Queue` instances across the tree are ever explicitly closed
(`queue.close()`)., and there's no shared factory/singleton (unlike `libs/shared/src/db/client.ts`'s
single `basePrisma` instance) ensuring exactly one Redis connection per queue name process-wide.

**Impact:** Low practical risk under the current Next.js standalone-server deployment (ADR-001,
Docker Compose — a genuinely long-running Node process, not a per-request serverless function),
but it's a DIP violation worth flagging (checklist item 10.3) and a real risk if the deployment
target ever changes to a per-invocation serverless runtime, where each cold start would leak a
new, never-closed Redis connection — the exact class of bug already found once in this project
(the Dockerfile/worker crash-loop bug, `c3f9f03`) for "assumption holds in the current deploy
target, breaks silently in a different one."

**Recommendation:** Centralize `Queue` instantiation the same way `libs/shared/src/db/client.ts`
centralizes the Prisma client — a single shared module (e.g.
`libs/shared/src/queues/registry.ts`) exporting one `Queue` instance per queue name, imported by
both the Route Handlers and the worker, so there's exactly one source of truth for connection
lifecycle if it ever needs explicit management.
