# Runbook: Disk full on the VPS

**Severity:** Critical (SEV-1) if `postgres` starts refusing writes; High if caught early via alert
#5 (disk usage on `postgres_data`) before that point.
**SLOs this protects:** `web-core-availability-slo` (a full disk eventually takes every write path
down simultaneously — the worst kind of single point of failure on a single-VPS topology).
**Architecture reference:** ADR-001/ADR-003 (single VPS, single disk, no k8s/multi-node — there is
no "drain to another node" option here, unlike a cloud-native runbook template).
**Why this runbook exists:** this is not a hypothetical failure mode for this project — this exact
incident type was hit once already during this project's own development session. It was previously
only covered by a generic "disk pressure triage" placeholder in
`Claude-Production-Grade-Suite/sre/slo/alerting-thresholds.md` (alert #5) — this runbook replaces
that placeholder with the real procedure. See also `Claude-Production-Grade-Suite/sre/chaos/
scenarios/05-disk-full-vps.yaml` for the game-day version of this same scenario.

## What this looks like in practice

- Alert #5 fires (disk usage on the `postgres_data` volume, warn 80% / critical 90%) — **if this
  monitoring is actually wired up**; `docs/architecture/production-deployment.md` §6 confirms no
  monitoring stack exists yet as of this writing, so in practice the first signal today may instead
  be:
- Postgres write errors surfacing as 5xx responses across the app (stock entries, sales, billing —
  everything that writes) simultaneously, with no obvious code-level cause.
- `docker compose logs postgres` showing `No space left on device` or similar.
- NF-e/CSV uploads (`uploads_data` volume — a *separate* volume from `postgres_data`, but the same
  physical disk on a single-VPS topology) failing independently, possibly with a different error
  shape than the Postgres failures — don't assume they're the same root cause without checking.

## Step 0 — Confirm it's actually disk space, not something else

```bash
df -h /                      # host root filesystem
df -h /var/lib/docker        # Docker's data-root, if on a separate mount
docker system df             # Docker's own view: images, containers, volumes, build cache
```

If `df -h /` (or wherever Docker's data-root lives) shows the relevant filesystem at or near 100%,
this is confirmed. If disk usage looks normal but Postgres is still erroring, this is a different
incident (check `postgres-connection-pool-exhaustion.md` or a plain Postgres crash) — don't proceed
with disk-full remediation against the wrong root cause.

## Step 1 — Identify what's actually consuming the space

```bash
docker system df -v                      # per-volume breakdown
du -sh /var/lib/docker/volumes/*/         # if the above isn't granular enough
docker compose exec postgres du -sh /var/lib/postgresql/*
```

The most likely candidates for this codebase, in rough likelihood order:
1. **`postgres_data`** — WAL growth from a stuck replication slot (not applicable, no replication
   in this topology) or, more likely, autovacuum falling behind on a fast-growing append-only table
   (`stock_movements`/`audit_log`, per `capacity/bottleneck-analysis.md` §4). Check:
   ```sql
   SELECT schemaname, relname, n_dead_tup, last_autovacuum
   FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;
   ```
2. **`uploads_data`** — unbounded NF-e/CSV upload accumulation, no retention policy exists today
   (`capacity/bottleneck-analysis.md` §3, a confirmed gap, not a guess).
3. **Docker image/build layer bloat** — repeated `docker compose up -d --build` deploys
   (`cd-production.yml`'s deploy step rebuilds on every deploy) can accumulate old, unused image
   layers if `docker image prune` is never run.
4. **Container logs** — stdout/stderr logging with no rotation configured (`production-deployment.md`
   §5 confirms containers log to stdout only, no log-driver size caps evidenced in
   `docker-compose.yml`) can grow unbounded on a long-running container under `docker compose logs`'s
   default json-file log driver.

## Step 2 — Free space (ordered safest-first)

1. **Docker build/image cleanup (safest, reversible, no data risk):**
   ```bash
   docker image prune -a -f          # removes unused images — safe, they can be rebuilt
   docker builder prune -f           # build cache — safe, next build is just slower once
   ```
2. **Log truncation (safe if you don't need old logs for this specific incident's own
   post-mortem — capture anything relevant BEFORE truncating):**
   ```bash
   docker compose logs app worker postgres redis > /tmp/pre-truncate-logs-$(date +%s).log
   # then, if using the default json-file driver with no size cap:
   truncate -s 0 $(docker inspect --format='{{.LogPath}}' estoque-saas-app-1)
   # repeat per container as needed — confirm actual container names via `docker compose ps`
   ```
3. **Uploads retention (only if `uploads_data` is confirmed the main consumer in Step 1) —
   manual, one-time triage during an active incident:**
   - Identify NF-e imports older than a safe cutoff whose parse status is `completed` (the parsed
     data is durably in Postgres; the raw XML's only remaining value is audit/dispute evidence —
     confirm against ADR-005/ADR-007 before deleting anything, and prefer archiving off-box over
     deleting if there's any doubt).
   - This is a manual, careful action during an incident, not a scripted bulk-delete — the
     automated retention policy recommended in `capacity/scaling-configs.yaml` doesn't exist yet;
     don't improvise a destructive bulk delete under incident pressure without a second pair of
     eyes if a second person is available.
4. **Postgres autovacuum (if `n_dead_tup` from Step 1 is high):**
   ```sql
   VACUUM (VERBOSE, ANALYZE) stock_movements;
   VACUUM (VERBOSE, ANALYZE) audit_log;
   ```
   Note: `audit_log` has `REVOKE UPDATE, DELETE FROM app_user` (C-2, immutability by design) — this
   does NOT prevent `VACUUM` (which reclaims dead-tuple space from the table's own internal
   updates/deletes, not from application-level row changes), so this is safe to run even against
   the immutable audit table.
5. **Last resort — provision more disk / attach a new volume.** Only after 1-4 are exhausted and
   the root cause is genuine sustained growth, not a one-time spike — this is a DevOps
   provisioning decision (new volume, resize), not something to do reactively mid-incident without
   understanding why growth outpaced expectations first.

## Decision tree

```
Is postgres refusing writes right now?
├── YES → Emergency Mitigation (below) FIRST, then Step 1/2 above
└── NO (caught via alert #5 before failure)
    └── Proceed calmly through Step 1/2 above — this is a High, not Critical, incident
        at this point; you have time to identify the real consumer before acting
```

## Emergency Mitigation (postgres already refusing writes)

1. Run Step 2.1 (Docker image/build prune) immediately — safest, fastest, no data risk, often
   enough to unblock Postgres on its own if image bloat was the actual cause.
2. If still full, run Step 2.2 (log truncation) — capture logs first if this is a security- or
   billing-relevant incident where the logs themselves might be evidence.
3. Re-check `df -h` after each step — do not skip straight to Step 2.3/2.4 (uploads/vacuum) without
   confirming whether 2.1/2.2 alone already resolved it; the safest fixes should be tried first.
4. Once `df -h` shows meaningful headroom (recommend confirming below 80%, not just "not 100%
   anymore" — leave margin, don't immediately re-trigger the same incident):
   ```bash
   docker compose restart postgres app worker
   ```
   Confirm whether a restart was actually necessary (Postgres often recovers writes on its own once
   space frees, without a restart) — record this either way, it's a useful data point for the next
   incident and for `chaos/scenarios/05-disk-full-vps.yaml`'s own findings.

## Fix and verify

1. Re-run the steady-state baseline from `Claude-Production-Grade-Suite/sre/chaos/
   steady-state-hypothesis.md`.
2. Confirm no partially-written/orphaned data from requests that failed during the outage — check
   for `nfe_imports` rows whose status implies a file should exist but doesn't (or vice versa),
   per the same check called out in the chaos scenario's `recovery_verification`.
3. Re-submit any write requests known to have failed during the window and confirm they now
   succeed.

## Post-incident

- Note what actually consumed the disk (don't guess after the fact — the Step 1 commands' output
  is the record) and how close to launch/how much real production data existed at the time.
- If root cause was **uploads growth with no retention policy**, this is direct evidence to
  prioritize `capacity/scaling-configs.yaml`'s `uploads_data` retention recommendation.
- If root cause was **autovacuum falling behind**, check whether `stock_movements`/`audit_log`
  growth is tracking `capacity/load-model.md`'s projections or exceeding them — exceeding them
  unexpectedly is itself a finding worth a follow-up.
- If alert #5 was NOT wired up yet at the time of this incident, this is the concrete argument for
  prioritizing the monitoring-stack gap noted in `docs/architecture/production-deployment.md` §6.
