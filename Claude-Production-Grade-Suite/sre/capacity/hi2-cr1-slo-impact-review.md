# Review: does HI-2 (BullMQ retry/backoff) or CR-1 (stock advisory lock) change T9a's SLOs? (T9b item 4)

**Conclusion up front:** T9a's SLO targets in `slo/sli-definitions.yaml` **still hold** — no target
number needs to change. Both fixes make the system's actual behavior *more* consistent with what
T9a already assumed (retries were implicitly assumed for reliability targets to be achievable;
correct concurrency handling was implicitly assumed for the stock-write latency budget to mean
anything). But both fixes introduce new latency-shaped and contention-shaped behavior that T9a
could not have reasoned about (the bugs didn't exist as "fixed" yet) — this document records the
new considerations without redefining the targets, per this task's instruction to build on T9a's
work and only touch it for a genuine gap.

## HI-2 — BullMQ retry/backoff (`attempts: 3`, exponential backoff from 5000ms)

**What changed:** every job that previously failed permanently on its first transient error now
gets up to 3 attempts, with backoff delays of ~5s, ~10s, ~20s between attempts (BullMQ's
exponential backoff formula: `delay * 2^(attempt-1)`).

**Where this interacts with existing SLOs:**

- **`job-alert-scan-slo`** (p95 60s, hard_ceiling 5m, tied to a hard BRD acceptance criterion —
  `sli-definitions.yaml`): this is the SLO with the least tolerance in the whole system. If
  `scan-expiry-alerts` hits a transient failure (e.g., a momentary Postgres blip) on its first
  attempt, the retry sequence alone adds ~5s before attempt 2, and up to ~15s more before attempt 3
  if attempt 2 also fails — a worst-case double-failure-then-succeed path could add **up to ~15-35s
  of pure backoff delay** on top of normal processing time. Against a 60s p95 target, this is
  meaningful but not automatically a breach (60s was never a hard ceiling — it's the p95 SLI
  threshold, and the *hard_ceiling* is 5 minutes, which retries with this backoff profile cannot
  realistically threaten on their own). **Verdict: no target change needed**, but recommend
  DevOps/monitoring treat "this job needed >1 attempt" as a signal worth surfacing on its own
  (not just pass/fail against the SLO), since a job that succeeds only on attempt 2-3 is silently
  eating into the 60s budget in a way the SLO's rolling-window math will average away rather than
  surface as a trend. This is a monitoring granularity recommendation, not an SLO redefinition.
- **`job-billing-charge-generation-slo`** (p95 30m after scheduled run, hard_ceiling 24h): HI-2's
  retry profile is trivially inside this budget — even 3 failed attempts with backoff adds well
  under a minute of delay against a 24-hour ceiling. **No practical interaction.**
- **`job-nfe-import-latency`** (p50 start delay 30s, p95 completion 5m, hard_ceiling 15m): same
  reasoning — backoff delay is small relative to the budget. **No practical interaction**, though
  worth noting NF-e parsing failures are more likely to be *permanent* (malformed XML) than
  transient, per `worker-queue-backlog-growing.md` Step 4's own distinction — HI-2's retry mostly
  helps the *other* job types more than this one.
- **Net reliability effect (not captured by any single SLO number):** HI-2 closes a real gap T9a's
  SLOs implicitly assumed was already closed — a permanently-dropped job on first transient failure
  was previously a silent SLO violation with no mechanism to self-heal. Chaos scenario 1
  (`chaos/scenarios/01-worker-crash-mid-job.yaml`) is the concrete validation that this assumption
  now actually holds in practice, not just in the queue configuration.

**Recommendation:** no change to `sli-definitions.yaml` targets. Add a one-line operational note
(done, see the addendum appended to that file) flagging that a job needing >1 attempt should be
visible in whatever job-processing dashboard DevOps eventually builds, distinct from the
pass/fail-against-SLO signal.

## CR-1 — `pg_advisory_xact_lock` on stock writes

**What changed:** every stock-mutating operation (entry, exit, sale, transfer, NF-e confirm) now
acquires a Postgres advisory transaction lock keyed on `(tenant_id, product_id, store_id)` before
reading/writing the derived balance. This SERIALIZES concurrent operations against the same
product+store — which is the entire point (it's what fixes the lost-update/oversell bug) — but a
lock that didn't exist before now has real latency and contention characteristics that didn't
exist before either.

**Where this interacts with existing SLOs:**

- **`web-write-latency-slo`** (p95 1500ms for RLS-scoped transactional writes): this is the SLO
  most directly exposed to CR-1's new behavior, since stock writes are exactly the write path CR-1
  modified. Under the realistic concurrency this system expects (PME retail, 1-5 operators per
  store — `load-model.md`), lock wait time should be negligible (the lock is held only for the
  duration of a single fast transaction: lock + balance read + insert). Under **pathological**
  contention (many concurrent writers to the exact same product+store — e.g. a bulk NF-e import
  landing on a SKU that's simultaneously being sold at the register), lock wait time is currently
  **unbounded** (no `lock_timeout` configured — `production-readiness/readiness-review-ship.md`
  §3/§4), meaning a worst-case pile-up could push individual requests' effective latency well past
  the 1500ms p95 target, and in the true worst case (no timeout) past any target at all. **Verdict:
  no target change needed at realistic 1x concurrency**, but this is now the most concrete,
  evidence-backed argument for prioritizing the `lock_timeout` recommendation in
  `readiness-review-ship.md` — without it, a burst of legitimate concurrent writes to one hot SKU
  degrades from "the fix working as intended, just a bit slower" into "unbounded queueing," which
  is a qualitatively different (and worse) failure mode. Chaos scenario 6
  (`chaos/scenarios/06-stock-lock-contention-hot-sku.yaml`) is designed to produce the real p95/p99
  lock-wait number this reasoning is currently theoretical without.
- **Connection pool capacity (not itself an SLO, but the thing several SLOs depend on):** a
  connection blocked on a lock wait holds its Postgres connection — and therefore its slot in the
  already-unconfigured-default connection pool (`bottleneck-analysis.md` §1) — for the wait
  duration. This means CR-1's lock and the pre-existing connection-pool gap **compound**: neither
  is individually a crisis at 1x scale, but together they're the most concrete "two Medium/High
  findings interacting to become worse than either alone" story in this whole review. This is
  exactly why `readiness-review-ship.md` calls out closing the connection-pool/timeout gap as the
  single highest-priority item before onboarding the first real concurrent-multi-operator customer.
- **`job-nfe-import-slo`:** NF-e confirm also goes through `lockStockRow()` (per
  `stock/nfe-import.ts:142`, listed as a CR-1 call site). A large NF-e import with many line items
  touching several different products will acquire and release the lock once per product+store
  pair as it processes — since different products don't contend with each other (the lock key
  includes `product_id`), this should not meaningfully slow a typical import UNLESS the import
  contains many lines for the *same* product+store (unusual but not impossible — e.g. multiple
  batches of the same SKU on one invoice). **No target change needed**, flagging as a minor edge
  case worth keeping in mind if NF-e import latency ever regresses unexpectedly.

**Recommendation:** no change to `sli-definitions.yaml` targets. The concrete, actionable output of
this analysis is prioritization guidance, already reflected in
`production-readiness/readiness-review-ship.md`'s ranking and `capacity/scaling-configs.yaml`'s
`lock_timeout: 5s` recommendation — this document is the "why," those are the "what to do about
it."

## Summary for the SLO document itself

An addendum note (not a target change) has been appended to `slo/sli-definitions.yaml` pointing
readers here, so a future reader of the SLO file sees the connection to HI-2/CR-1 without this
analysis being silently disconnected from the numbers it's reasoning about.
