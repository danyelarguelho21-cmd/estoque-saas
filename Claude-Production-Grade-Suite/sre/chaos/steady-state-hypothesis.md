# Steady-State Hypothesis — estoque-saas

**Topology reminder:** single VPS, Docker Compose, no k8s (ADR-001/003) — "steady state" here means
observable via `docker compose ps`/`logs`, `redis-cli`, `psql`, and the app's own HTTP surface, not
a Prometheus/Grafana stack (none is deployed yet — see `production-deployment.md` §6). Every check
below is something a solo/pair operator can actually run by hand during a game day; none require
tooling that doesn't exist in this system.

## Definition

The system is in steady state when ALL of the following are true:

### Service health
- `docker compose ps` shows `app`, `worker`, `postgres`, `redis` (and `caddy` in prod) all
  `healthy`/`running`, zero restarts in the last 10 minutes.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/healthz` → `200`.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/readyz` → `200`.
- p95 latency for a representative write endpoint (`POST /api/stock/entries` or `/api/stock/exits`)
  stays under 1500ms (`web-write-latency-slo` threshold, `sli-definitions.yaml`) across a manual
  sample of 10 sequential requests before/after each experiment.

### Data integrity
- `getCurrentStock()`-derived balance for a known test product matches a manually-computed sum of
  its `stock_movements` rows (sanity check: `SELECT balance_after FROM stock_movements WHERE
  product_id = '<test>' ORDER BY created_at DESC LIMIT 1`).
- No duplicate `audit_log` rows for the same logical event within the experiment window
  (`SELECT event_type, entity_id, COUNT(*) FROM audit_log WHERE created_at > '<experiment_start>'
  GROUP BY 1,2 HAVING COUNT(*) > 1` returns zero rows — directly exercises the HI-4 fix under real
  concurrency).
- BullMQ queue depths (`redis-cli LLEN bull:<queue>:wait`) return to their pre-experiment baseline
  within the queue's own SLA window (60s for `alerts`, per `job-alert-scan-slo`).

### Business-observable behavior
- A low-stock scenario manually triggered (drop a test product below its minimum) surfaces in the
  alerts list within 60s post-recovery (the hard BRD acceptance criterion this system's `job-alert-
  scan-slo` exists to protect — see `sli-definitions.yaml`).
- No customer-visible 5xx on `web-core-availability`'s critical paths (auth, stock, sales, billing)
  outside the experiment's own deliberately-injected failure window.

## Baseline capture (do this before every experiment, not just once)

```bash
docker compose ps
curl -sw '\n%{http_code}\n' http://localhost:3000/api/healthz
curl -sw '\n%{http_code}\n' http://localhost:3000/api/readyz
docker compose exec redis redis-cli LLEN bull:nfe-import:wait
docker compose exec redis redis-cli LLEN bull:alerts:wait
docker compose exec redis redis-cli LLEN bull:billing:wait
docker compose exec postgres psql -U estoque_app -d estoque_saas -c \
  "SELECT count(*) FROM pg_stat_activity WHERE datname = 'estoque_saas';"
```

Record the output. Every experiment's "recovery confirmed" step means: re-run this same block and
diff against the baseline — not "looks fine."
