# Runbook: Worker queue backlog growing (NF-e imports / alerts / billing jobs not processing)

**Severity:** Warning → Critical depending on which queue and how long (see thresholds below). The `alerts` queue escalates fastest because it maps directly to a hard BRD acceptance criterion (60s).
**SLOs this protects:** `job-nfe-import-slo`, `job-alert-scan-slo`, `job-billing-charge-generation-slo` (see `Claude-Production-Grade-Suite/sre/slo/sli-definitions.yaml`).
**Architecture reference:** ADR-001 (worker is a separate process, same image, different CMD), ADR-005 (NF-e import is async by design).

## What this looks like in practice

- Alert #4 fires from `Claude-Production-Grade-Suite/sre/slo/alerting-thresholds.md`: a BullMQ queue's `waiting` count is above threshold and growing, not shrinking.
- Operators report NF-e imports stuck in "processing" indefinitely, or low-stock/expiry alerts not appearing despite stock clearly being low (violates the BRD 60s acceptance criterion directly).
- Billing charge generation didn't run on schedule (check against `job-billing-charge-generation-latency` hard_ceiling of 24h — if this queue is the one backed up, treat as billing-critical and also consult `pagbank-webhook-processing-stopped.md`, since both draw on the same worker process).

## Step 0 — Is the worker even running?

```
docker compose ps worker
docker compose logs worker --tail 200
```

- **Worker container not running / crash-looping:** this is the most common and simplest cause. Check the crash reason in logs — common candidates for this codebase: unhandled exception in a job handler (a single bad job payload crashing the whole process rather than just failing that job — check whether job handlers are wrapped to catch and fail individual jobs, not the process), Postgres/Redis connection loss on startup (check `DATABASE_URL`/`REDIS_URL` env and that `postgres`/`redis` health checks are passing — worker has `depends_on: condition: service_healthy` on both), or OOM (check `docker compose logs worker` for an OOM kill, and host-level memory).
- **Worker container running but not consuming:** more subtle — this is the case alert #2 (`Claude-Production-Grade-Suite/sre/slo/alerting-thresholds.md`) exists to catch, and is currently under-detected because `worker` has no `healthcheck` block in `docker-compose.yml` today (flagged as an infra gap for DevOps in the alerting doc). Proceed to Step 1.

## Step 1 — Which queue, and is it actually growing (vs. just busy)?

```
docker compose exec redis redis-cli LLEN bull:nfe-import:wait     # adjust key names to actual BullMQ queue names in code
docker compose exec redis redis-cli LLEN bull:alerts:wait
docker compose exec redis redis-cli LLEN bull:billing:wait
docker compose exec redis redis-cli LLEN bull:<queue>:active
docker compose exec redis redis-cli LLEN bull:<queue>:failed
```

Take two readings a few minutes apart. Distinguish:
- **`active` count is 0 and stays 0 while `wait` is nonzero** → worker isn't picking up jobs at all from this queue. Go to Step 2.
- **`active` count is nonzero but `wait` keeps growing anyway** → worker IS processing, just too slowly for the incoming rate (throughput problem, not a stuck problem). Go to Step 3.
- **`failed` count is high and growing** → jobs are being attempted and erroring repeatedly (possibly retrying per BullMQ's retry config before landing in `failed`). Go to Step 4.

## Step 2 — Worker not picking up jobs from this queue at all

- Confirm the worker process actually registers a processor for this queue name — a typo'd queue name, or a queue added on the producer (`web`) side without a matching consumer registered in `worker`'s entrypoint, will silently accumulate `wait` forever with zero errors anywhere. Check `worker`'s startup logs for the list of queues it's listening on.
- Confirm Redis connectivity from the worker's perspective isn't degraded (intermittent connection drop can leave BullMQ's internal consumer loop not re-subscribing cleanly, depending on BullMQ version/config) — restart the `worker` container (`docker compose restart worker`) as a first cheap mitigation while investigating root cause; if the backlog immediately starts draining after restart, the root cause was a wedged consumer loop, not a code bug — still worth writing up so it can be caught by the (currently missing) worker healthcheck instead of relying on a human noticing.

## Step 3 — Worker processing, but too slowly for the queue's SLA

- For the **`alerts` queue specifically**: this has almost no tolerance (60s SLA per BRD). If throughput is the issue, check whether a single alert-scan job is doing more work than expected (e.g. scanning ALL tenants' stock in one job instead of being partitioned/batched) — a scaling issue as tenant count grows, not necessarily a bug today at <1,000 tenants, but worth checking whether it's trending toward the threshold.
- For **`nfe-import`**: check whether a small number of unusually large XML files (per ADR-005, "notas com centenas de itens") are monopolizing the worker — BullMQ concurrency setting may need tuning, or large imports may need their own queue/concurrency lane so they don't starve smaller, faster imports.
- For **`billing`**: check whether this queue's jobs are scheduled in a burst (e.g. all due-date charge generations queued at the same cron tick) — if so, a wide burst against low concurrency will look like "backlog" even though nothing is actually broken; confirm against the 30-minute/24-hour SLO window before treating this as an incident rather than expected batch shape.
- Mitigation while investigating: check `worker` container resource usage (`docker stats worker`) — on a single VPS, CPU/memory contention with `app` or `postgres` on the same host is a real and common cause of "worker got slower," not just code-level throughput.

## Step 4 — Jobs failing and retrying (or landing in `failed`)

- Inspect a few failed jobs' stored error/stack trace (BullMQ retains this on the job data) — do not just retry blindly.
- Common categories for this codebase: 
  - **RLS/tenant-context errors** — jobs run "per job" (ADR-001: worker sets RLS context per job, similar to per-request in `web`); if a job's tenant context isn't set correctly before its DB queries, expect RLS to correctly return zero rows or throw, not silently succeed with wrong data — but that itself will look like "job failing" or "job succeeding with no effect," so check whether affected jobs correlate with a code path that's missing the tenant-context setup.
  - **Malformed NF-e XML** — per ADR-005 this is an expected, handled case (`status = failed` with a message, not a crash) — confirm failures are the *expected* handled kind (bad XML) vs. an *unexpected* exception in the parser itself. The former is not an incident; the latter is.
  - **PagBank API errors on billing jobs** — transient (rate limit, timeout) vs. persistent (bad credentials, malformed request) — see `pagbank-webhook-processing-stopped.md` if this overlaps with webhook/reconciliation issues.

## Fix and verify

1. Apply the fix (restart wedged worker, fix missing consumer registration, tune concurrency, fix the handler bug causing failures).
2. Watch `wait` count trend back down to baseline, not just stop growing.
3. For the `alerts` queue specifically: manually verify a real low-stock/expiry scenario surfaces within 60s post-fix (this queue's SLA is a hard product acceptance criterion, not just an SRE nicety — spot-check it, don't assume the metric alone proves it).
4. Check whether the backlog caused any *missed* alerts (not just delayed ones) — if the alert-scan job design is "scan current state" rather than "replay every missed trigger," a long enough backlog could mean some low-stock windows were never surfaced at all, which needs a manual catch-up scan, not just letting the queue drain.

## Post-incident

- Note which queue, how long the backlog lasted, peak `wait` count, and whether any BRD-relevant SLA (the 60s alert criterion in particular) was actually violated for real users, not just in theory.
- If root cause was "worker crash-looped and nothing caught it" — this is direct evidence for prioritizing the worker healthcheck gap noted in `Claude-Production-Grade-Suite/sre/slo/alerting-thresholds.md`.
