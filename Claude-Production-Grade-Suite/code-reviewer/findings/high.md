# High Findings — Wave B Code Review (estoque-saas)

---

### [HI-1] Unbounded N+1 query pattern repeated across four endpoints (per-product loop instead of one batched query)

**Severity:** High
**Category:** Performance
**Location:**
- `services/app/src/modules/stock/alerts.ts:16-38` (`listLowStockAlerts`) — loops over **every**
  non-deleted product **sequentially** (`for...of`, not even `Promise.all`), up to 2 queries per
  product (`productStoreSetting.findUnique` + `getCurrentStock`), with **no pagination at all**.
- `services/app/src/modules/sales/dashboard.ts:91-111` (`getStalledProducts`) — loops over every
  product, one `stockMovement.findFirst` per product, sequential, unbounded.
- `services/app/src/modules/sales/dashboard.ts:52-88` (`getStockTurnover`, `groupBy: "product"`
  branch) — `Promise.all(products.map(async product => getCurrentStock(...)))`, one raw query per
  product with sales in the last 90 days.
- `services/app/src/modules/stock/expiry-scan.ts:59-71` (`scanOneTenant`, low-stock half of the
  daily job) — same per-product `getCurrentStock` + `alreadyNotifiedRecently` loop, run **once per
  active tenant, every day**, inside one long-held transaction per tenant (see HI-1a below).
- `services/app/src/modules/catalog/products.ts:60` (`listProducts`) — bounded to `limit+1`
  (max 101, since the route handler correctly clamps `limit` to 100 via Zod — checklist item 11.2
  passes), but still N+1 per page: up to 101 raw `getCurrentStock` queries per list-products
  request.

**Description:**
`getCurrentStock()` itself is already a non-trivial query (`SELECT DISTINCT ON (store_id) ...
FROM stock_movements WHERE product_id = ... ORDER BY store_id, created_at DESC` — effectively a
per-product index scan back to that product's most recent movement per store). Calling it once
per product in a loop, instead of once for the whole product set, is the textbook N+1 pattern
this review is explicitly scoped to hunt for (Phase 3 checklist item 11.1). Three of the four
call sites (`listLowStockAlerts`, `getStalledProducts`, `expiry-scan`'s low-stock half) are
**also unbounded** — they fetch the tenant's entire product catalog with no `take`/pagination,
so the N in N+1 grows without limit as a tenant's catalog grows. For the target market (PME —
small/medium Brazilian retail), a few hundred to a few thousand SKUs is a realistic catalog size,
not a hypothetical.

`listLowStockAlerts` is the worst instance: it's a plain `for...of` loop (not even parallelized
with `Promise.all` like the dashboard functions), so its total latency scales linearly with
catalog size with no concurrency to offset it — and it's invoked from a low-stock alerts
page (`api/openapi/stock.yaml#listLowStockAlerts`) a user could reasonably load on every visit.

**Impact:** Request latency for the alerts endpoint, the stalled-products/turnover dashboard
widgets, and the daily expiry-alert worker job will all degrade roughly linearly with catalog
size, eventually timing out or meaningfully slowing the shared worker process (which also runs
NF-e parsing and billing jobs — see H-3 in Security Engineer's Wave A findings on the shared
worker having no per-tenant isolation, which compounds with this).

**Recommendation:** Replace each per-product loop with one batched query using the same
`SELECT DISTINCT ON` technique `getCurrentStock` already uses, parameterized over the whole
product-id set at once (`WHERE product_id = ANY($1)`), then match results back to products in
application code — same total cost as today's *single* `getCurrentStock` call, but O(1) queries
instead of O(n). Add `take`/cursor pagination to `listLowStockAlerts` and `getStalledProducts`
(currently the only two catalog-wide endpoints in the reviewed modules with no pagination at
all) per the same `CursorParam`/`LimitParam` convention already used everywhere else in
`api/openapi/*.yaml`.

---

### [HI-2] BullMQ jobs have no retry/backoff configured — a transient failure permanently drops the job

**Severity:** High
**Category:** Architecture Conformance (design-principles.md "Resilience" — checklist item 8.7,
confirmed violated) / Reliability
**Location:**
- `services/app/src/app/api/nfe-imports/route.ts:25` — `parseNfeQueue.add("parse-nfe", {...}, { jobId: importId })`
- `services/app/src/app/api/products/import/route.ts:19` — `importQueue.add("import-products-csv", {...})`
- `services/app/src/worker/index.ts:72-76,79-83` — the two repeatable jobs
  (`generate-monthly-charge`, `scan-expiry-alerts`)
- No `new Queue(...)` call anywhere in the tree passes `defaultJobOptions`.

**Description:** All four `.add()` call sites pass only `{ jobId }` or `{ repeat, jobId }` — no
`attempts` or `backoff`. BullMQ's bare default for a job with no `attempts` configured is a
**single attempt, no retry**. Confirmed by grepping every `new Queue(` and `.add(` call site in
the tree — none set `defaultJobOptions` either, so there is no fallback retry policy at any
level.

**Impact:** A worker restart mid-job (the kind of transient failure Docker/Compose deploys cause
routinely), a brief Postgres/Redis blip, or any other non-deterministic transient error
permanently fails the job with zero automatic recovery:
- `parse-nfe` — an NF-e upload silently gets stuck in a failed/incomplete state with no retry,
  requiring the user to re-upload.
- `generate-monthly-charge` — the daily billing-cycle job (06:00) is the highest-stakes instance:
  if it fails transiently, a tenant's subscription simply doesn't get charged/invoiced that day,
  with no automatic catch-up, silently breaking revenue collection until someone notices.
- `scan-expiry-alerts` — a missed run means a day's worth of expiry/low-stock alerts silently
  never fire.

**Recommendation:** Set `defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } }`
(tune per queue — `generate-monthly-charge` in particular should alert on final failure, not just
retry silently) on each `new Queue(...)` instantiation, or pass equivalent per-call options at
each `.add()` site.

---

### [HI-3] PagBank HTTP client has no request timeout

**Severity:** High
**Category:** Architecture Conformance (design-principles.md Resilience — checklist item 8.6,
explicitly named "its absence is a High finding") / Reliability
**Location:** `libs/shared/src/payments/providers/pagbank.ts:57-83` (`pagbankFetch`)

**Description:** `pagbankFetch()` calls plain `fetch(url, requestInit)` with no
`AbortSignal.timeout(...)`/`AbortController` anywhere in `requestInit`. If PagBank's API hangs or
degrades, this call can block for however long Node's default fetch behavior allows (effectively
unbounded), which blocks whatever called it: a subscription-creation request from a real user, or
the `generate-monthly-charge` worker job, which (per `billing/monthly-charge.ts`) loops over
**every active tenant sequentially** — one hung PagBank call there stalls billing generation for
every tenant queued behind it in that day's run, not just the one tenant whose call hung.

**Recommendation:** `fetch(url, { ...requestInit, signal: AbortSignal.timeout(10_000) })` (pick a
value consistent with any stated NFR latency budget), map the resulting `TimeoutError` to a typed
error the caller can retry against (pairs naturally with HI-2's retry/backoff recommendation for
whatever job path calls into billing).

---

### [HI-4] PagBank webhook idempotency check-then-act is not race-safe under concurrent duplicate delivery

**Severity:** High
**Category:** Code Quality (Concurrency) — also flagged as design-principles.md checklist item
8.8, which names this exact failure mode explicitly ("not a check-then-insert with a window for
two concurrent webhook deliveries to both pass the check")
**Location:** `services/app/src/modules/billing/webhook.ts:39-61` (`processPagBankWebhook`)

**Description:** The idempotency guard is a plain read-then-write: `tx.invoice.findUnique(...)`,
then a separate `if (!invoice || invoice.gatewayEventId === event.gatewayEventId) return;` check,
then `tx.invoice.update(...)`. Payment gateways routinely re-deliver webhooks that time out on
the receiving end, so two near-simultaneous deliveries of the *same* event are a realistic
scenario, not a contrived one. Under READ COMMITTED (see CR-1 — same isolation-level gap, same
root cause across the codebase), two concurrent transactions processing the same webhook event
can both execute the `findUnique` before either commits its `update`, both see
`gatewayEventId !== event.gatewayEventId` (still null/stale), both pass the guard, and both
proceed to run `subscription.updateMany(...)` and `recordAudit(...)` a second time. The
`gateway_event_id UNIQUE` constraint (ADR-004, `invoices` table) does **not** prevent this,
because both transactions update the *same* invoice row to the *same* value — that's not a
uniqueness conflict.

**Impact:** `invoice.status` itself still converges to the correct final value (idempotent in
that narrow sense), but the side effects are not idempotent: a duplicate `audit_log` entry is
created, and `subscription.updateMany` runs twice. For a system whose audit log is explicitly
positioned as evidence for billing disputes (ADR-007), a duplicated entry for the same event is a
real defect, not cosmetic. `tests/integration/webhook-idempotency.test.ts` only exercises two
**sequential** calls (first awaited to completion before the second starts) — it would not catch
this, since sequential calls can never race.

**Recommendation:** Make the `UPDATE` itself the atomic idempotency guard instead of a prior
`SELECT`: e.g. `tx.invoice.updateMany({ where: { id: match.invoice_id, gatewayEventId: { not: event.gatewayEventId } }, data: {...} })`
and branch the subsequent `subscription.updateMany`/`recordAudit` calls on whether that update's
returned count was `1` (this transaction "won" the race) vs `0` (already applied by a concurrent
or prior delivery — no-op). Add a genuinely concurrent test (two `Promise.all`-parallel POSTs
with the same payload, not two sequential ones) alongside the existing sequential one.

---

### [HI-5] `check-module-boundaries.js` re-run: 11 hits, all confirmed false positives — recording so the scanner isn't miscalibrated by a future reader

**Severity:** N/A (informational — not a finding against the implementation, a note on scanner precision)
**Category:** Architecture Conformance tooling

Ran `node Claude-Production-Grade-Suite/code-reviewer/check-module-boundaries.js` against the
current tree (202 files scanned). All 11 reported violations were manually verified and are
**not** real ADR-002/ADR-004 violations — they're legitimate, documented exemptions the Wave A
scanner's static rules don't model:

- 7× `platformPrisma` in `auth/{login,signup,invite,tenant}.ts` and
  `billing/{plans,subscriptions,monthly-charge,webhook}.ts` — all are either `plan.findUnique`
  (Plan is explicitly RLS-exempt per ADR-002 §5, checklist item 2.2) or a narrow
  `SECURITY DEFINER` cross-tenant lookup function called via `$queryRaw`
  (`auth_lookup_user_by_email`, `billing_lookup_tenant_by_gateway_ref` — needed because login and
  webhook processing don't know the tenant_id yet, by definition, before the lookup runs).
  `getTenantWithPlan` in `auth/tenant.ts` in particular is the exact function the
  `333cf7e` fix commit repaired (it used to bypass `withTenant`; it now correctly wraps its query
  in `withTenant`, and the scanner's `platformPrisma` regex match is only tripping on the file's
  own comment text explaining the fix, not on the code).
- `libs/shared/src/index.ts` and `payments/providers/pagbank.test.ts` importing
  `./payments/providers/pagbank` — the barrel file re-exporting its own module, and that module's
  co-located test file. Structurally required, not a leak.
- `services/app/src/app/cadastro/page.tsx` importing `@/lib/payments/pagbank` — this resolves to
  `services/app/src/lib/payments/pagbank.ts`, a **different, legitimate** file: a client-side
  PagBank.js tokenization wrapper (card number never leaves the browser — PCI requirement), not a
  backend call to PagBank's API. ADR-004's "no direct PagBank SDK/HTTP calls outside the provider
  file" is about server-to-server calls; a client-side tokenization widget is the architecturally
  *correct* place for this to live, not a violation of it.

No action needed on the implementation. If the scanner is wired into CI later (per its own
header comment), it should gain an allowlist for `$queryRaw`-based `platformPrisma` lookups
functions and for `services/app/src/lib/payments/pagbank.ts` specifically, or it will produce
permanent false-positive noise on every run.
