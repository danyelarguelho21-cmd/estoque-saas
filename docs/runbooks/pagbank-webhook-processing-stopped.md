# Runbook: PagBank webhook processing stopped / subscriptions stuck

**Severity:** Billing-critical (SEV-2 by default; escalate to SEV-1 if paying customers are actively being locked out, or non-paying customers are actively retaining access, in a way that's growing over time).
**SLOs this protects:** `pagbank-webhook-ack-slo`, `pagbank-webhook-reconciliation-slo`, `pagbank-webhook-availability-slo`, `job-billing-charge-generation-slo` (see `Claude-Production-Grade-Suite/sre/slo/sli-definitions.yaml`).
**Architecture reference:** ADR-004 (PaymentProvider abstraction), BRD Epic 9 (Assinatura e cobrança).

## What this looks like in practice

- Alert #6 or #7 from `Claude-Production-Grade-Suite/sre/slo/alerting-thresholds.md` fires (webhook non-2xx rate, or reconciliation stuck > 15 min).
- A customer reports their card was charged but the app still shows them as inadimplente (or the reverse: shows active but PagBank shows a failed/cancelled charge).
- `nfe_imports`-style status table for billing (whatever table/queue tracks `PaymentWebhookEvent` processing, per ADR-004) shows events stuck in a non-terminal state.

## Step 0 — Isolate WHICH stage is stuck (this determines everything else)

There are two independent failure points; treat them as separate branches, don't guess:

**Branch 1: Webhook isn't being *received/ack'd* at all** (PagBank → `web`)
- Symptom: no new webhook deliveries in `web` access logs at all, despite known billing activity (a charge was created, a due date passed).
- This is either (a) PagBank can't reach the VPS (DNS, reverse proxy, TLS, firewall — outside app architecture scope per C4 notes, likely a DevOps-owned check first), or (b) the `app` container itself is down (check alert #1), or (c) the specific webhook route is broken/mis-registered while the rest of the app works.

**Branch 2: Webhook is received/ack'd fine, but *reconciliation* is stuck** (async processing after ack)
- Symptom: webhook delivery logs show 200s being returned promptly (ack SLO is fine), but the subscription/invoice state in the database isn't updating.
- This means the `web` → enqueue → `worker` → reconcile pipeline (ADR-004's normalized `PaymentWebhookEvent` flow) is broken somewhere after the ack. Most likely: `worker` container down/wedged, or the billing queue backed up, or a bug in the reconciliation handler causing events to fail/retry-loop.

Check `docker compose ps` and container logs (`docker compose logs app --tail 200`, `docker compose logs worker --tail 200`) first — this alone often tells you which branch you're in within a minute.

## Branch 1 — Webhook not received/ack'd

1. Confirm the endpoint is reachable at all: `curl -i -X POST https://<domain>/<webhook-path>` from outside the VPS (or check reverse proxy logs). A connection failure/timeout here is a DevOps-owned infra issue (TLS/proxy/firewall/DNS) — hand off, but keep billing informed since the business impact is on this runbook's owner.
2. If reachable but PagBank isn't calling it: check the `notification_urls` configured on the PagBank side (dashboard or API) still points at the correct current URL — a VPS migration, domain change, or reverse-proxy path change can silently break this with no error on our side.
3. If the route is being hit but erroring: check `app` logs around the webhook route specifically for exceptions — most likely causes given ADR-004's design:
   - `verifyWebhookSignature` failing (a rotated PagBank signing secret not updated in our env config is the most common cause — check `.env`/secrets against PagBank dashboard).
   - `parseWebhookEvent` throwing on a payload shape we don't handle (PagBank added a new event type or changed a field — check the raw payload captured before normalization, if we log/persist it; if we don't, add that logging now, since a normalization bug shouldn't lose the raw event).
4. **Assumption flag (see `sli-definitions.yaml`):** PagBank's public docs don't document a specific retry policy. If the endpoint was down/erroring for a while, we don't know for certain whether PagBank retried and gave up, or never retried at all — assume some deliveries may be permanently lost and reconcile manually (Step 3 below) rather than assuming PagBank "will retry eventually."

## Branch 2 — Received but not reconciling

1. Check the billing queue depth and trend (BullMQ). If using `redis-cli` directly against the `redis` container:
   ```
   docker compose exec redis redis-cli LLEN bull:billing:wait     # adjust key to actual queue name
   docker compose exec redis redis-cli LLEN bull:billing:failed
   ```
   A growing `wait` count with `worker` up but idle → worker is not consuming (see `worker-queue-backlog-growing.md`). A growing `failed` count → jobs are erroring and going to the failure queue; inspect the failure reason (BullMQ stores the error/stack on the failed job).
2. Check for **idempotency-related stalls**: if reconciliation dedupes on PagBank's notification/event ID (per the ASSUMPTION-driven idempotency design in `sli-definitions.yaml`), confirm the dedupe table/constraint isn't itself the blocker — e.g. a unique-constraint violation being thrown (and unhandled) instead of being treated as "already processed, skip."
3. Check for a stuck/long-running transaction holding a lock on the subscription/invoice row (Postgres): 
   ```sql
   SELECT pid, now() - query_start AS duration, state, query
   FROM pg_stat_activity
   WHERE state != 'idle' AND now() - query_start > interval '1 minute'
   ORDER BY duration DESC;
   ```
   If a billing-related query has been running/blocked for a long time, this may be a lock contention issue rather than a queue issue.
4. If a specific event is confirmed stuck (not a systemic queue issue), and the fix will take time: manually verify the actual payment state via the PagBank dashboard/API directly (not our webhook data) for the affected subscription(s), and manually correct the subscription/invoice state in the DB if a customer's access is being wrongly affected **right now**. Log this manual override clearly (who, when, why, source of truth used) — it must be reconciled/verified once the automated pipeline is fixed, not left as a silent one-off.

## Immediate mitigation while root-causing (if customer impact is active)

- **Paying customer locked out incorrectly:** this is the more urgent direction — a real customer losing access to a tool they're paying for, actively, right now. If root cause isn't found within ~15-30 minutes, manually restore access for confirmed-paying customers (verify via PagBank dashboard directly) while continuing to fix the pipeline.
- **Non-paying customer keeping access:** lower urgency (revenue leakage, not customer-facing breakage) — do not rush a manual fix here at the cost of slowing down the lockout investigation above. Fix the pipeline, then reconcile.

## Fix and verify

1. Fix the identified root cause (signature secret, parsing bug, worker not consuming, lock contention, dedupe bug).
2. Re-check queue depth trend and reconciliation latency return to normal (compare against `pagbank-webhook-reconciliation-latency` thresholds: p95 60s, hard ceiling 15m).
3. Reconcile any events that were manually patched during mitigation against the now-working automated pipeline — confirm no double-application happened (this is exactly what the idempotency/dedupe design exists to prevent, but verify rather than assume during recovery from a manual intervention).
4. Sweep for any other subscriptions that may have silently drifted during the outage window (not just the one(s) reported) — query for subscriptions whose local state hasn't been updated since before the incident window started, and diff a sample against PagBank's actual state.

## Post-incident

- Note how long the outage/stuck window was, how many events/subscriptions were affected, and whether any customer was incorrectly locked out or incorrectly retained access, and for how long.
- If the root cause was "we didn't know PagBank's real retry/timeout behavior" — this is the moment to actually verify it (contact PagBank support, or test in sandbox) and update the ASSUMPTION note in `Claude-Production-Grade-Suite/sre/slo/sli-definitions.yaml` with real numbers.
