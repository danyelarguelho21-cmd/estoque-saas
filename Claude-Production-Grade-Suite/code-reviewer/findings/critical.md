# Critical Findings — Wave B Code Review (estoque-saas)

Re-anchored against `Claude-Production-Grade-Suite/.orchestrator/tasks.md` (BUILD Wave A
merge-back + the 3 post-merge "real bugs found running the full stack" commits
`333cf7e`/`72ec4c5`/`c3f9f03`) and the Wave A `conformance-checklist.md` (97 checkpoints).
This pass re-ran `check-module-boundaries.js` for real against the actual implementation and
manually read every stock-mutating code path. Security/OWASP analysis is out of scope — see
`Claude-Production-Grade-Suite/security-engineer/findings/` (currently Wave A threat-model
content; T6c code-level audit is a separate, parallel task).

---

### [CR-1] Lost-update race condition on stock balance across every stock-mutating operation

**Severity:** Critical
**Category:** Code Quality / Concurrency (Performance-adjacent, but this is a correctness bug —
data integrity, not just latency)
**Location:**
- `libs/shared/src/db/client.ts:35-43` (`withTenant` — no isolation level set, no locking)
- `services/app/src/modules/stock/balance.ts:9-38` (`getCurrentStock` / `nextBalanceAfter` — the
  shared read-then-write helper)
- `services/app/src/modules/stock/resolve-batches.ts:37-42` (stock-sufficiency check — same
  pattern)
- Every caller: `services/app/src/modules/stock/entries.ts:43`,
  `services/app/src/modules/stock/exits.ts:39`,
  `services/app/src/modules/stock/transfers.ts:80,122`,
  `services/app/src/modules/stock/nfe-import.ts:142`,
  `services/app/src/modules/sales/sales.ts:56`

**Description:**
`getCurrentStock()` runs a plain `SELECT DISTINCT ON (store_id) ... ORDER BY created_at DESC`
against `stock_movements` to derive "current balance," and `nextBalanceAfter()` is just
`getCurrentStock() + delta`. Every stock-mutating path (manual entry, exit/loss, sale, transfer
leg, NF-e confirm) does this SELECT, computes a new `balance_after` in application code, then
INSERTs a new `stock_movements` row carrying that computed value — with **no row lock
(`SELECT ... FOR UPDATE`), no Postgres advisory lock, and no non-default transaction isolation
level**. `withTenant()` (`libs/shared/src/db/client.ts:39`) opens a plain
`basePrisma.$transaction(...)` with no `isolationLevel` option, so every one of these
transactions runs at Postgres's default **READ COMMITTED**.

Under READ COMMITTED, two concurrent transactions can both execute the SELECT before either
commits its INSERT — each sees the same "current" balance, computes the same (or an
individually-correct-looking) `balance_after`, and both commit successfully. There is no
constraint anywhere that would reject the second write: each transaction inserts a brand-new
`stock_movements` row, so nothing conflicts at the database level. The result is a classic lost
update: the row with the later `created_at` (whichever transaction happens to commit its INSERT
last) becomes "the current balance" on the next read, silently discarding the other
transaction's decrement/increment from the derived balance — even though both rows, and both
audit-log entries, exist and look individually correct.

The exact same read-then-write pattern also gates the **stock-sufficiency check**
(`resolveExitLines`, `stock/resolve-batches.ts:37-42` and the batch-quantity check at line
29-34): two concurrent sales/exits against the same product+store can both read sufficient
stock, both pass the `< quantity` check, and both commit — allowing the business to sell/exit
more stock than physically exists (classic TOCTOU), not merely miscount it afterward.

**This is precisely the scenario the HARDEN task brief calls out as a real, plausible bug
class for this system** ("two operators registering stock movements on the same product/store
simultaneously, a sale racing a stock entry") — it is present, unmitigated, and untested.

**Confirmed untested:** grepped `tests/` for `concurrent`/`race`/parallel `Promise.all` patterns
exercising two simultaneous writers — none exist. `tests/integration/webhook-idempotency.test.ts`
tests two **sequential** calls to the same endpoint, which is a different scenario (it doesn't
exercise the interleaving that causes a lost update). No test in the suite would fail if this bug
regressed further.

**Impact:**
- Two operators (or an operator + the sales flow) hitting the same product/store concurrently can
  cause the system to silently under-report depletion — the dashboard, low-stock alerts, and
  `resolveExitLines`'s own sufficiency check all read the same corrupted derived balance.
- Concurrent sales can oversell stock that doesn't exist (the sufficiency check itself races),
  which for a PME inventory SaaS is a direct, customer-visible correctness failure (selling
  something the shelf doesn't have) — not a rare edge case, but an expected pattern of real
  multi-operator usage (register + stockroom operating at the same time) that this checklist
  explicitly predicted needed a dedicated look (ADR-006 design-principles.md 8.9 "no operação faz
  escrita parcial").
- Every `stock_movements.balance_after` value becomes untrustworthy under any real concurrent
  load, undermining the entire "audit trail" value proposition of the movements table (ADR-007's
  premise that the ledger is authoritative).

**Recommendation:**
Pick one (do not try to layer all three):
1. **Row lock the contention point.** Before computing `balance_after`/checking sufficiency,
   acquire a Postgres advisory lock keyed on `(tenant_id, product_id, store_id)` — e.g.
   `SELECT pg_advisory_xact_lock(hashtext(tenant_id || product_id || store_id))` — at the top of
   every `withTenant` block in `entries.ts`/`exits.ts`/`sales.ts`/`transfers.ts`/`nfe-import.ts`'s
   confirm path. Cheapest fix, no schema change, serializes exactly the contended rows.
2. **`SELECT ... FOR UPDATE`** on the most-recent `stock_movements` row for that
   `(product_id, store_id)` before computing the new balance — same effect, but requires the
   query to target a single lockable row rather than a `DISTINCT ON` aggregate.
3. **Materialize the balance** into its own `(tenant_id, product_id, store_id)`-keyed table with a
   unique constraint, and update it via a single atomic
   `UPDATE stock_balances SET quantity = quantity + $delta WHERE ... RETURNING quantity` — the
   database itself then serializes concurrent writers via the row's own lock, and a
   `CHECK (quantity >= 0)` constraint (or a `WHERE quantity >= $requested` guard on the UPDATE)
   closes the TOCTOU oversell gap for free. Bigger change (new table, migration), but removes the
   derived-`DISTINCT ON`-scan cost too (see High finding on N+1/`getCurrentStock` cost) as a
   side benefit.

Whichever is chosen, add the integration test this checklist calls for and QA's suite currently
lacks: two concurrent `createStockExit`/`createSale` calls against the same product+store with
combined demand exceeding available stock — assert exactly one succeeds (or both succeed only if
combined demand fits), and assert the final `getCurrentStock()` reflects both decrements, not
just one.
