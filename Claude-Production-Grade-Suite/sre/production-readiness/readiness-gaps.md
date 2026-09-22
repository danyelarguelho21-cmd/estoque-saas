# Production Readiness — Gaps Surfaced (Wave A scope note)

**Scope note:** this Wave A task was scoped to SLO/error-budget/alerting/runbook definitions only. A full production-readiness checklist pass (health checks, graceful shutdown, connection pooling, retries, resource limits, data-safety review across every module) is deferred to SHIP, alongside chaos engineering and capacity planning. The items below are gaps surfaced incidentally while defining SLOs and alert thresholds against `docker-compose.yml` and the ADRs — not an exhaustive review.

## Gaps

1. **`worker` container has no `healthcheck` block** (`docker-compose.yml`, compare to `app`/`postgres`/`redis`, which all have one). This means:
   - `docker compose ps` reports `worker` as running even if its internal job-consumption loop is wedged.
   - No `depends_on: condition: service_healthy` is possible for anything that should wait on `worker` being genuinely ready.
   - Alert #2 in `Claude-Production-Grade-Suite/sre/slo/alerting-thresholds.md` ("worker container down or not consuming jobs") needs a liveness signal beyond "process exists" to be reliable — recommend DevOps add one (HTTP/TCP liveness port, or a heartbeat timestamp/Redis key touched each poll loop) before wiring that alert for real.
   - Referenced from `docs/runbooks/worker-queue-backlog-growing.md` Step 0.

2. **PagBank webhook retry/timeout policy is not publicly documented** (verified via WebSearch of `developer.pagbank.com.br`, 2026-09-21 — see the ASSUMPTION note at the bottom of `Claude-Production-Grade-Suite/sre/slo/sli-definitions.yaml`). The SLOs and runbook for webhook processing are built around a documented assumption (fast-ack + idempotent processing) rather than verified gateway behavior. Recommend confirming actual behavior with PagBank support or a sandbox test before the first paying customer goes live on the card-recurring flow (BRD Epic 9).

3. **No PagBank webhook idempotency/dedupe table is confirmed to exist yet** in the codebase as reviewed for this task (ADR-004 defines the `PaymentProvider` interface and normalized event shape, but does not itself specify a dedupe mechanism). This is flagged here because the webhook runbook and SLOs assume idempotent processing as the primary defense against an unknown retry policy — if Software Engineer hasn't implemented a dedupe table/unique constraint on the provider's event ID yet, that's a gap to close before relying on this runbook's guidance in production.

These are handed off as gaps, not fixed directly — per conflict-resolution protocol, SRE reviews infrastructure/implementation for reliability concerns but DevOps/Software Engineer own the fixes.
