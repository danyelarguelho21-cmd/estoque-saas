# Runbook: Postgres connection pool near exhaustion / exhausted

**Severity:** Critical (SEV-1) if requests are hanging/timing out platform-wide; High if caught
early via alert #3 (80% warn / 95% critical) before requests start failing.
**SLOs this protects:** `web-core-availability-slo`, `web-write-latency-slo` (a single shared
Postgres instance means exhaustion affects every tenant simultaneously — see ADR-001/002).
**Architecture reference:** `Claude-Production-Grade-Suite/sre/production-readiness/
readiness-review-ship.md` §3/§6 (the underlying gap: no `connection_limit`/`pool_timeout`/
`statement_timeout`/`lock_timeout` configured anywhere as of this writing), `capacity/
bottleneck-analysis.md` §1 (why this is ranked the #1 bottleneck at 1x scale), `capacity/
hi2-cr1-slo-impact-review.md` (how CR-1's advisory lock can compound this specific failure mode).
**Why this runbook exists:** `alerting-thresholds.md` alert #3 previously pointed at "general
Postgres saturation triage until a dedicated runbook is written" — this is that runbook.

## What this looks like in practice

- Alert #3 fires (active connections as % of `max_connections`).
- Multiple unrelated endpoints start returning 5xx or hanging simultaneously — this is the
  signature of a shared-resource exhaustion, not a single endpoint's bug. If only ONE endpoint is
  affected, this is probably not this incident (check that endpoint's own logic first).
- `chaos/scenarios/02-postgres-connection-exhaustion.yaml` and `chaos/scenarios/
  06-stock-lock-contention-hot-sku.yaml` are the two chaos experiments that specifically target
  this failure mode — if a game day has been run, check its findings for what "this actually looks
  like" turned out to be in practice.

## Step 0 — Confirm it's actually connection exhaustion

```bash
docker compose exec postgres psql -U estoque_app -d estoque_saas -c "SHOW max_connections;"
docker compose exec postgres psql -U estoque_app -d estoque_saas -c \
  "SELECT count(*), state FROM pg_stat_activity GROUP BY state ORDER BY count(*) DESC;"
```

If total connection count is near `max_connections` (default 100 for `postgres:18-alpine`, unless
DevOps has overridden it per `capacity/scaling-configs.yaml`'s recommendation), this is confirmed.

## Step 1 — What's holding the connections?

```sql
SELECT pid, usename, application_name, state, wait_event_type, wait_event,
       now() - query_start AS query_duration, now() - xact_start AS txn_duration, query
FROM pg_stat_activity
WHERE datname = 'estoque_saas'
ORDER BY txn_duration DESC NULLS LAST
LIMIT 30;
```

Look for the pattern, not just the count:

- **Many rows with `state = 'idle in transaction'` and a long `txn_duration`** → an orphaned open
  transaction (e.g., an unhandled exception between acquiring CR-1's advisory lock and committing
  the following writes, if the surrounding `$transaction` callback doesn't roll back cleanly on
  error — this is exactly what `idle_in_transaction_session_timeout` in `capacity/
  scaling-configs.yaml`'s recommendation exists to bound, and it is NOT configured today). Go to
  Step 2.
- **Many rows with `wait_event_type = 'Lock'`** → genuine lock contention, most likely CR-1's
  `pg_advisory_xact_lock` under a burst of concurrent writes to the same `(tenant_id, product_id,
  store_id)` — check `query` for `pg_advisory_xact_lock` specifically to confirm. Go to Step 3.
- **Many rows with `state = 'active'` and short, varied queries, just a high raw count** → this is
  genuine load exceeding the configured (or default, unconfigured) pool size, not a leak or a
  contention bug — go to Step 4.

## Step 2 — Orphaned idle-in-transaction connections

1. Identify the offending connections (from Step 1's query, filtered to `state = 'idle in
   transaction'` with unusually long `txn_duration` — minutes, not seconds).
2. Terminate them (this is safe — an idle-in-transaction connection has no pending work to lose,
   by definition; terminating it just forces the rollback that should have already happened):
   ```sql
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE state = 'idle in transaction' AND now() - xact_start > interval '2 minutes';
   ```
3. This buys immediate relief but does NOT fix the root cause — find which code path left a
   transaction open (grep for `$transaction` callbacks that could throw without the callback's own
   promise rejecting cleanly, or a code path using `$queryRaw`/`$executeRaw` outside a `$transaction`
   wrapper per the same anti-pattern class called out in `postgres-rls-misconfiguration-cross-
   tenant-leak.md` root-cause checklist item 4) and file it as a bug, not just a one-time cleanup.

## Step 3 — Genuine lock contention (likely CR-1's advisory lock)

1. Confirm which `(tenant_id, product_id, store_id)` key is contended:
   ```sql
   SELECT pid, query, now() - query_start AS waiting_duration
   FROM pg_stat_activity
   WHERE wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock%'
   ORDER BY waiting_duration DESC;
   ```
2. This is CR-1's fix working AS INTENDED (serializing concurrent writes to the same
   product+store) under load it wasn't primarily designed to absorb gracefully yet — the fix
   itself is correct (see `capacity/hi2-cr1-slo-impact-review.md`), the missing piece is a
   `lock_timeout` to bound the wait. **Do not roll back CR-1** — the bug it fixed (lost updates,
   oversell) is worse than transient write-latency under a legitimate burst.
3. Immediate mitigation: identify if one specific product+store is a genuine hot spot (e.g. a bulk
   NF-e import touching the same SKU that's also being actively sold) and, if operationally
   possible, ask the operator to pause the bulk operation until the live traffic burst subsides —
   a manual, human mitigation while the `lock_timeout` configuration gap gets closed properly.
4. If connections are piling up specifically because of unbounded lock waits (not just normal lock
   wait time), the same `pg_terminate_backend()` approach from Step 2 is a valid emergency release
   valve for the OLDEST waiting connections specifically — but understand this means that specific
   request will fail/timeout for its caller, not silently succeed; only do this if the alternative
   is total pool exhaustion for every other tenant.

## Step 4 — Genuine load exceeding pool size (no leak, no contention — just volume)

1. Confirm no `connection_limit` is configured (likely, per the gap this runbook exists to
   address) — if so, this is expected behavior of an unbounded-by-config pool hitting Postgres's
   own ceiling, not a code bug.
2. Immediate mitigation: if `max_connections` has headroom relative to the VPS's actual capacity,
   temporarily raise it (`ALTER SYSTEM SET max_connections = <higher>;` then restart Postgres —
   requires a brief outage, weigh against just riding out the current spike if it's expected to be
   short-lived, e.g., a one-time bulk import).
3. Root fix: implement `capacity/scaling-configs.yaml`'s `connection_limit`/`pool_timeout`
   recommendation — this is a DevOps/Software-Engineer implementation task (`.env`/connection
   string change), not something to hot-patch mid-incident beyond the temporary mitigation above.

## Fix and verify

1. Confirm `pg_stat_activity` count returns to baseline (`chaos/steady-state-hypothesis.md`'s
   baseline-capture block).
2. Re-submit any requests known to have failed/hung during the incident and confirm success.
3. If Step 2's root cause (orphaned transaction) was found, confirm the specific code path has
   been fixed, not just the symptom cleaned up once.

## Post-incident

- Record which of Steps 2/3/4 applied — this determines whether the fix is a code bug, an
  operational/config gap, or expected-but-unconfigured behavior under real load, and routes to a
  different owner accordingly (Software Engineer for a leaked transaction; DevOps for the
  connection_limit/timeout configuration; capacity re-planning if genuine volume exceeded
  `capacity/load-model.md`'s projections).
- If this was CR-1 lock contention (Step 3): this is the concrete production evidence to close the
  `lock_timeout` gap immediately, not just note it as a backlog item — see `capacity/
  hi2-cr1-slo-impact-review.md` for why this specific interaction was already flagged as the
  top-priority follow-up from this SHIP pass.
