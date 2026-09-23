# Runbook: Stock write latency spike / suspected advisory-lock contention

**Severity:** Medium by default (degraded latency on a bounded set of operations); escalate to High
if `web-write-latency-slo` is breaching sustained, or if requests are hanging rather than just
slow (evidence the missing `lock_timeout` gap has turned contention into an unbounded wait — see
below).
**SLOs this protects:** `web-write-latency-slo` (p95 1500ms).
**Architecture reference:** this runbook exists specifically because of code-reviewer finding CR-1
(`services/app/src/modules/stock/balance.ts:16`, `pg_advisory_xact_lock` keyed on `(tenant_id,
product_id, store_id)`) — a Critical correctness fix (closes a lost-update/oversell bug) that also
introduces a genuinely new contention point that did not exist in the buggy code it replaced. See
`Claude-Production-Grade-Suite/sre/capacity/hi2-cr1-slo-impact-review.md` for the full analysis
this runbook operationalizes, and `chaos/scenarios/06-stock-lock-contention-hot-sku.yaml` for the
game-day validation of this exact scenario.

**Do not roll back CR-1 in response to this runbook.** The lock is the fix, not the bug. This
runbook is about tuning/mitigating contention around a correct fix, never about reverting to the
pre-fix behavior (which silently corrupts stock balances and allows overselling — strictly worse).

## What this looks like in practice

- Elevated p95/p99 latency specifically on stock-mutating endpoints (`POST /api/stock/entries`,
  `/api/stock/exits`, `/api/sales`, `/api/stock/transfers`, NF-e import confirmation) while OTHER
  endpoints (catalog reads, dashboards, auth) remain normal — this asymmetry is the signature of
  lock contention specifically, not a general Postgres/infra problem (if everything is slow, see
  `postgres-connection-pool-exhaustion.md` instead).
- Reports of "the register is slow" or "saving a stock entry took a long time" concentrated around
  a specific product or store, especially during a bulk operation (NF-e import, CSV import) landing
  on the same SKU that's also being actively sold/adjusted.

## Step 0 — Confirm it's lock contention, not general slowness

```sql
SELECT pid, query, wait_event_type, wait_event, now() - query_start AS waiting_duration
FROM pg_stat_activity
WHERE wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock%'
ORDER BY waiting_duration DESC;
```

Multiple rows here, all waiting on the same lock (same underlying `hashtext(...)` argument, which
you can't read back directly from `pg_locks` but can infer from correlating `query` text with
`tenant_id`/`product_id`/`store_id` in the surrounding application logs if logged) confirms this.

## Step 1 — Identify the specific hot product+store

- Check application logs / recent activity for the affected time window: which product and store
  are involved in the contended writes? Common causes for this codebase specifically:
  - A bulk NF-e import (`ADR-005`, "notas com centenas de itens") landing on a SKU that's
    simultaneously being sold at a register in the same store — the most realistic real-world
    trigger for this pattern given this system's actual usage shape.
  - A CSV product import that happens to touch the same SKU repeatedly in quick succession within
    its own job (unlikely but worth checking — `processProductsCsvJob` runs single-threaded per
    the worker's concurrency-1 default, so this specific self-contention is improbable but not
    impossible if the CSV has duplicate SKU rows).
  - Multiple operators genuinely working the same product+store simultaneously (the expected,
    designed-for case — CR-1's fix exists precisely so this is safe, just not necessarily fast
    under a large burst).

## Step 2 — Is this bounded contention (working as intended, just slow) or unbounded (a real incident)?

This is the critical distinction. Check the `waiting_duration` values from Step 0:

- **Waits measured in tens to low hundreds of milliseconds, resolving on their own as the queue of
  waiters drains** → this is CR-1 working exactly as designed under real concurrent load. Not an
  incident — monitor, but don't intervene. This is expected PME-retail-scale behavior.
- **Waits measured in seconds and climbing, or requests outright hanging (no response, not even a
  slow one)** → this is the unbounded-wait risk `readiness-review-ship.md` §3/§4 already flagged:
  **no `lock_timeout` is configured**, so there is currently no ceiling on how long a request can
  queue behind this lock. This IS an incident-worthy pattern — go to Step 3.

## Step 3 — Immediate mitigation for unbounded/long waits

1. If a specific bulk operation (NF-e/CSV import) is the identified cause and it's operationally
   safe to do so, ask the operator to pause it — the fastest way to relieve contention without
   touching production configuration mid-incident.
2. If waits are genuinely indefinite and blocking real customer operations with no clear bulk-job
   cause to pause, the emergency release valve is terminating the OLDEST waiting backend (this
   fails that specific request/its caller, which is an acceptable tradeoff against total pileup for
   every other request against the same product+store):
   ```sql
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock%'
   ORDER BY now() - query_start DESC LIMIT 1;
   ```
   Re-check Step 0's query after each termination — do this one at a time, not as a bulk kill,
   since killing the RIGHT one (oldest) lets the queue drain in order rather than randomly.
3. Cross-check connection pool state (`postgres-connection-pool-exhaustion.md` Step 1) — a
   long-running lock-wait pileup is exactly the scenario that can cascade into full connection
   exhaustion (each waiting request holds its connection). If pool exhaustion is also occurring,
   treat that runbook as the primary incident and this one as contributing root cause.

## Fix and verify

1. Confirm Step 0's query returns no more long-waiting rows.
2. Confirm the specific product+store's stock count is correct (no lost updates, no oversell) —
   this is CR-1's actual correctness guarantee; a contention incident should never produce a wrong
   final balance, only a slow one. If the balance IS wrong, that's a regression in CR-1 itself —
   Critical severity, escalate immediately, this is a different and much more serious problem than
   the latency this runbook otherwise addresses.
3. Re-run the steady-state baseline (`chaos/steady-state-hypothesis.md`).

## Post-incident

- Record the actual observed wait durations and the specific product+store/operation pattern that
  triggered it — this is real data to replace the theoretical estimates in `capacity/load-model.md`
  and `capacity/hi2-cr1-slo-impact-review.md`.
- If this recurs, prioritize `capacity/scaling-configs.yaml`'s `lock_timeout: 5s` recommendation —
  a request that fails fast with a clean "try again" error under contention is a materially better
  user experience than one that hangs indefinitely, and closing this gap converts every future
  occurrence of this runbook from "SEV-2 incident" to "expected behavior, no action needed."
