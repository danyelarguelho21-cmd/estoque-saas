# Game Day Playbook — estoque-saas

**Audience:** the same 1-2 person team that runs this system day to day (see `error-budget-policy.md`
§3 — no separate on-call org exists, and this playbook doesn't invent one). Every step below is
something one or two people can run from a laptop with SSH access, against either a local dev
stack or a disposable staging VPS. **Never run scenarios 2, 5, or 6 against production data.**

## Pre-Game Day (do this the day before, not the morning of)

- [ ] Pick a low-traffic window (this product has no meaningful "business hours" traffic pattern
      yet — pick whenever the operator running it is uninterrupted for ~2 hours).
- [ ] Confirm you're running against a **disposable stack**, not production, for scenarios 2
      (postgres-connection-exhaustion), 5 (disk-full-vps), and 6 (stock-lock-contention). Scenarios
      1 (worker-crash), 3 (redis-unavailable), and 4 (webhook-flood) are safe against production
      IF run against a test tenant/test webhook payload — confirm the payload/tenant IDs used are
      test fixtures, not real customer data, before starting.
- [ ] Re-read `steady-state-hypothesis.md` and dry-run the baseline-capture command block once
      before the game day starts, so you're not debugging your own tooling mid-experiment.
- [ ] Have `docs/runbooks/` open in a second window — several scenarios below reference a specific
      runbook as the "what would I actually do at 2am" version of the same failure.
- [ ] Confirm `git status` is clean on the target stack before starting (so any unexpected file
      changes during the game day are visible, not lost in pre-existing noise).

## Abort Criteria (apply to EVERY round, not just the "risky" ones)

Stop the current experiment and move straight to its documented `recovery` step if ANY of:

- A container crash-loops for more than 2 minutes without the experiment's own recovery step
  resolving it.
- Data integrity check fails (duplicate audit_log entry, stock count doesn't match expected,
  balance corruption) — this is the one category of "unexpected result" that is itself the
  incident, not just a finding to write up calmly afterward.
- A request hangs past 30 seconds with no response (evidence of unbounded waiting — itself a
  finding, but also a sign to stop rather than let it compound).
- You are running against production and customer-visible impact becomes evident (support message,
  error rate you didn't expect on a NON-test tenant) — abort immediately, this takes priority over
  finishing the round.

There is no "push through it, see what happens next" mode for this team's risk tolerance. Abort
cleanly, recover, write down what happened, and re-plan rather than improvise further chaos on top
of an already-abnormal state.

## Experiment Sequence

Ordered low-risk → higher-risk, matching each scenario file's own `risk` field.

### Round 1 — Worker crash recovery (Low risk)
1. Capture steady-state baseline (`steady-state-hypothesis.md`).
2. Run `chaos/scenarios/01-worker-crash-mid-job.yaml`.
3. Observe recovery for 5 minutes — specifically watch the killed job get retried and complete.
4. Document: did HI-2's retry/backoff actually save the job, or did it land in `failed`?

### Round 2 — Redis unavailable (Medium risk)
1. Confirm steady state restored from Round 1.
2. Run `chaos/scenarios/03-redis-unavailable.yaml`.
3. Observe all three affected paths (rate-limit fail-open, enqueue failure mode, worker
   reconnect behavior) — this round has three separate pass/fail signals, check all three.
4. Document: did the NF-e import path fail cleanly, or with a raw unhandled exception?

### Round 3 — PagBank webhook flood + duplicate delivery (Medium risk)
1. Confirm steady state restored from Round 2.
2. Run `chaos/scenarios/04-pagbank-webhook-flood-duplicate.yaml` against a **test tenant/test
   subscription only**.
3. Query `audit_log` for duplicate entries immediately after — this is the single most important
   check in this round (HI-4 regression = Critical, escalate immediately per abort criteria).
4. Document: observed ack latency (p50/p95/p99 of the 32 requests) — feed into
   `capacity/load-model.md`.

### Round 4 — Stock advisory-lock contention on a hot SKU (Medium risk, disposable stack only)
1. Confirm steady state restored from Round 3.
2. Run `chaos/scenarios/06-stock-lock-contention-hot-sku.yaml`.
3. Observe lock-wait latency distribution and final stock-count correctness.
4. Document: observed p95 lock-wait time — feed into `capacity/hi2-cr1-slo-impact-review.md`.

### Round 5 — Postgres connection exhaustion (Higher risk, disposable stack only)
1. Confirm steady state restored from Round 4.
2. Run `chaos/scenarios/02-postgres-connection-exhaustion.yaml`.
3. Observe whether app requests fail cleanly/queue boundedly, vs. hang indefinitely.
4. Document: this round's result directly determines the urgency of the connection_limit/
   statement_timeout recommendation in `readiness-review-ship.md` §3 — treat a "hangs
   indefinitely" result as reason to escalate that recommendation ahead of other backlog work.

### Round 6 — Disk full on the VPS (Highest risk, disposable stack ONLY — never production)
1. Confirm steady state restored from Round 5.
2. Run `chaos/scenarios/05-disk-full-vps.yaml`.
3. Observe failure mode ordering (Postgres refuses writes vs. upload storage fills vs. Docker's
   own layer storage) and whether recovery requires more than freeing space + a restart.
4. Document: this is the incident type this project has already hit once during development —
   treat any surprising result here as high-priority, not routine.

## Post-Game Day

- [ ] Compile findings into a short incident-style note per round that revealed something
      unexpected (not every round needs a write-up — a round that matched its hypothesis exactly
      is itself a useful confirmation, note it briefly and move on).
- [ ] For any round where the steady-state hypothesis was violated: file it as a finding with the
      same severity language used elsewhere in this pipeline (Critical/High/Medium/Low), and route
      it to the owning skill (Software Engineer for app-code fixes, DevOps for
      `docker-compose*.yml`/Caddyfile changes) — SRE does not implement infra fixes itself, per
      `conflict-resolution.md`.
- [ ] Update the relevant runbook(s) under `docs/runbooks/` with anything learned that a real
      incident responder would want to know (an exact command that worked, a recovery time that
      was longer/shorter than assumed, a failure mode that didn't match the runbook's decision
      tree).
- [ ] Re-run this playbook after any of: the shared worker process gains real production traffic
      for the first time, the connection-pool/timeout gaps from `readiness-review-ship.md` are
      closed (re-run Round 5 to confirm the fix actually changes the observed behavior), or before
      onboarding the first Enterprise-tier customer if/when that plan tier exists
      (`error-budget-policy.md` §6 notes per-tier SLOs don't exist yet).
- [ ] No fixed "schedule a follow-up in 30 days" cadence is prescribed here — for a solo/pair team
      pre-launch, re-run this playbook when something material changes (see above), not on a
      calendar that will just get skipped. Revisit this decision once there's a real on-call
      rotation (see `error-budget-policy.md` §3).
