# Runbook: Redis unavailable

**Severity:** High by default (degrades three independent concerns simultaneously); escalate to
Critical if job processing has been stalled long enough to threaten `job-alert-scan-slo`'s hard
BRD-mandated ceiling, or if billing reconciliation is affected (cross-reference
`pagbank-webhook-processing-stopped.md`).
**SLOs this protects:** all `job-*-slo`s (BullMQ runs on Redis), indirectly `web-core-availability-
slo` (rate limiting and session/query cache also depend on Redis — see below).
**Architecture reference:** `docs/architecture/system-diagrams/c4-container.md` — Redis serves
THREE independent concerns in this system: BullMQ queues, the rate-limit store
(`services/app/src/lib/rate-limit.ts`, security-engineer finding H-5), and session/query cache.
There is no Redis failover/cluster in this topology (single VPS, single Redis instance — ADR-001).
**Why this runbook exists:** `alerting-thresholds.md` alert #8 previously pointed at "general —
evictions of queue data would look like #2/#4; treat as a possible root cause" with no dedicated
procedure. This is that procedure. See also `chaos/scenarios/03-redis-unavailable.yaml`.

## What this looks like in practice — THREE independent symptoms, check all three

Redis going down does not fail uniformly — each of the three concerns it serves degrades
differently, and understanding which ones are actually affected (vs. just "Redis is down, panic")
determines the right response:

1. **Rate limiting** — `checkRateLimit()` fails OPEN by explicit design (a deliberate tradeoff
   documented in `security-engineer/findings/high.md`'s H-5 writeup) — login/signup/admin-login
   should keep working, just without brute-force protection. **This is expected, not a bug** — do
   not treat "rate limiting isn't blocking anything right now" as evidence of a different problem
   when Redis is confirmed down.
2. **BullMQ queues** — NF-e import, CSV import, and any code path that calls `.add()` on a queue
   will either throw (if not wrapped) or silently fail to enqueue (if wrapped without proper error
   propagation) — `chaos/scenarios/03-redis-unavailable.yaml`'s whole purpose is determining which
   of these actually happens, since it was unverified at the time this runbook was written. Check
   the specific route handler's behavior empirically if this hasn't been confirmed yet via a game
   day run.
3. **Session/query cache** — degrades to "always a cache miss," which should mean slower responses
   (extra DB round-trips), not errors — if this is instead producing errors, that's a separate bug
   in the cache-miss fallback path, not expected Redis-down behavior.

## Step 0 — Confirm Redis is actually down (not just slow)

```bash
docker compose ps redis
docker compose exec redis redis-cli ping     # expect PONG; a hang or error confirms this
docker compose logs redis --tail 100
```

## Step 1 — Is this a container crash or a resource/config issue?

```bash
docker compose logs redis --tail 200 | grep -iE "oom|out of memory|maxmemory|error"
docker stats redis --no-stream               # quick resource snapshot if the container is up
```

- **OOM/maxmemory eviction** — per `alerting-thresholds.md` alert #8's original framing, this is
  the most likely root cause for a "Redis degraded but not fully down" scenario: queued jobs or
  cached sessions being evicted under memory pressure. Check `redis-cli INFO memory` for
  `evicted_keys` — a nonzero and climbing value confirms this. Immediate mitigation: restart Redis
  to clear memory pressure (queued-but-not-yet-processed BullMQ jobs may be lost if evicted before
  processing — this is a real, not theoretical, data-loss risk specific to this scenario, worse
  than a clean container restart). Root fix: `capacity/scaling-configs.yaml`'s Redis memory limit
  recommendation, sized with headroom above actual queue+cache+rate-limit usage.
- **Container crash/OOM-killed by Docker** — restart:
  ```bash
  docker compose up -d redis
  ```

## Step 2 — Confirm BullMQ/worker recovery after Redis returns

```bash
docker compose logs worker --since 2m | grep -i redis
docker compose exec redis redis-cli LLEN bull:nfe-import:wait
docker compose exec redis redis-cli LLEN bull:alerts:wait
docker compose exec redis redis-cli LLEN bull:billing:wait
```

BullMQ's underlying `ioredis` client should auto-reconnect without a `worker` container restart —
confirm this is actually happening (queue depths should start draining) rather than assuming it;
if `worker` needs a manual restart to resume consuming, that's worth noting as a finding (ioredis's
reconnect behavior not working as expected in this deployment).

## Step 3 — Assess data-loss risk

Redis's default persistence (RDB/AOF) configuration was not verified in this pass — if Redis is
running with no persistence (the `redis:7-alpine` image's default depends on how it's invoked;
`docker-compose.yml` does not pass any `--save`/`--appendonly` flags, meaning **default RDB
snapshotting behavior applies, not guaranteed durability of every queued job**), any BullMQ job
that was enqueued but not yet picked up (`waiting` state) at the moment Redis crashed (as opposed
to gracefully stopped) may be lost, not just delayed. This is a genuine gap worth flagging:

- Check whether the specific incident was a graceful stop (`docker compose stop redis` — RDB save
  on shutdown, if configured) vs. a crash/OOM-kill (no save, data loss risk is real).
- If jobs may have been lost: cross-reference against the originating action (an NF-e upload row
  stuck in `pending` with no corresponding queue entry; a due billing charge that never got
  generated — check against `job-billing-charge-generation-latency`'s hard_ceiling of 24h) and
  manually re-trigger/re-enqueue anything confirmed missing rather than assuming BullMQ's own
  recovery caught everything.

## Fix and verify

1. Confirm `redis-cli ping` returns `PONG` and stays stable (not flapping).
2. Confirm all 4 BullMQ queues are draining (Step 2).
3. Re-submit any NF-e/CSV import that failed during the outage and confirm success.
4. Re-run the steady-state baseline (`chaos/steady-state-hypothesis.md`).

## Post-incident

- Record whether this was OOM/eviction (config gap — see `capacity/scaling-configs.yaml`) vs. a
  plain crash (investigate why) vs. a host-level issue.
- If any queued job was confirmed lost (Step 3), this is the concrete argument for enabling Redis
  persistence (`appendonly yes` at minimum for the queue-critical use case) — currently not
  configured, and worth prioritizing specifically because BullMQ's own retry/backoff (HI-2)
  cannot help a job that was never durably queued in the first place.
- If the NF-e-import enqueue path was confirmed to fail with an unhandled exception rather than a
  clean mapped error (see `chaos/scenarios/03-redis-unavailable.yaml`'s follow_up), file that as a
  Software Engineer finding.
