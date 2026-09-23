# Production Readiness Review — SHIP (T9b)

**Date:** 2026-09-22
**Scope:** Full readiness pass against current state — post-HARDEN (T8, commit `fb3e338`), post-DevOps SHIP (T7: Caddy/TLS, backup/restore, CD workflow). Supersedes the Wave A checklist gap in `readiness-gaps.md` (that file is kept for history; its 3 items are re-verified below, not silently dropped).
**Method:** every line below is evidence-based — file path + line, or a command that was actually run against the source tree. No item is marked pass/fail on "should be fine."
**Target topology (do not grade against a topology this system doesn't have):** single VPS, Docker Compose, 4 containers in prod (`app`, `worker`, `postgres`, `redis`) + `caddy` reverse-proxy overlay. No k8s, no multi-AZ, no LB — per ADR-001/ADR-003. Checklist items below are interpreted for that topology, not for a Kubernetes deployment.

---

## 1. Health Checks

| Item | app | worker | postgres | redis | caddy |
|---|---|---|---|---|---|
| Liveness/readiness configured | `GET /api/healthz` (docker-compose.yml:76, 10s interval) | `pgrep -f 'src/worker/index.ts'` (docker-compose.yml:106, 15s interval) | `pg_isready` (docker-compose.yml:26) | `redis-cli ping` (docker-compose.yml:38) | `wget` against Caddy admin API `:2019/config/` (docker-compose.prod.yml:53) |
| Distinct readiness vs liveness | **Partial** — `services/app/src/app/api/healthz/route.ts` and `/api/readyz/route.ts` both exist as separate routes, but only `healthz` is wired into the Docker healthcheck; `readyz` is used solely by the CD smoke-test (production-deployment.md §4), not by Compose/Caddy | N/A — worker has no HTTP surface | N/A (single check by design) | N/A | N/A |
| Health check verifies downstream deps | `readyz` checks `platformPrisma.$queryRaw\`SELECT 1\`` (Postgres only) — **does not check Redis**, so a Redis outage (chaos scenario 3) is invisible to `readyz`/`healthz` even though it silently breaks all queue-backed functionality (NF-e import, alerts, billing) | **FAIL** — `pgrep` only confirms the Node process exists, not that it's actually consuming jobs (T9a's original gap, still open — see §7) | pass | pass | pass (checks Caddy's own admin API, not upstream `app` liveness beyond what Caddy's own active health check already separately performs per production-deployment.md §1) |
| Health checks are cheap (no expensive ops) | `SELECT 1` is cheap | pass (no I/O) | pass | pass | pass |

**Findings:**
- **[Medium, NEW]** `readyz` does not check Redis. Recommend adding a `redis.ping()` call to `readyz` (cheap, matches the "cheap ops" rule) so a Redis outage is visible to anything that polls readiness, not just to alert #8 in `alerting-thresholds.md`.
- **[High, T9a gap #1 — STILL OPEN, partially mitigated]** worker healthcheck exists now (it did not at T9a time — `docker-compose.yml` gap is closed at the "a healthcheck block exists" level), but it is a process-liveness check only (`pgrep`), not a job-consumption check. Alert #2 in `alerting-thresholds.md` ("worker not consuming jobs") still cannot be reliably built on top of this healthcheck alone — a wedged BullMQ consumer loop with the Node process still running will report healthy. See §7 for the concrete recommendation (heartbeat key in Redis).

## 2. Graceful Shutdown

| Item | Status | Evidence |
|---|---|---|
| SIGTERM/SIGINT handler | **FAIL** | `grep -r "SIGTERM" services/ libs/` — zero matches anywhere in the tree. Neither `app` (Next.js server) nor `worker` (`services/app/src/worker/index.ts`) installs a shutdown handler. |
| In-flight request draining | **FAIL (worker)** / Unverified (app) | `worker/index.ts` registers 4 `new Worker(...)` instances with no `close()` call on SIGTERM — a `docker compose stop`/rolling restart during `cd-production.yml`'s deploy step (`docker compose up -d --build`) sends SIGTERM, Docker's default `stop_grace_period` (10s) elapses, then SIGKILL. Any job actively running at that moment (NF-e parse, billing charge generation, webhook reconciliation) is killed mid-transaction, not drained. Next.js's default SIGTERM handling for `next start` does attempt connection draining, but this hasn't been verified against this app's custom server setup (none found — appears to be stock `next start` per `services/app/package.json`, which is a reasonable default but not something this review confirmed empirically). |
| terminationGracePeriod-equivalent | **Not configured** | No `stop_grace_period` override in `docker-compose.yml` or `docker-compose.prod.yml` — Docker's default (10s) applies. For `worker`, this is short relative to `job-nfe-import-latency`'s p95 of 5 minutes — a large NF-e import mid-parse at deploy time will always be hard-killed, not gracefully finished. |

**Findings:**
- **[High, NEW]** No SIGTERM handling in `worker/index.ts`. Combined with HI-2's new retry/backoff (attempts: 3, exponential backoff from 5s), a job killed mid-run by a deploy is *not* lost data-wise for the simple job types (BullMQ will consider it stalled and retry per `DEFAULT_JOB_OPTIONS`, since the job was never marked completed) — this is a genuine improvement HI-2 brought for free. But it **is** still a correctness risk for any job that performs multiple non-transactional side effects before the DB commit (e.g., a PagBank API call already fired before the process was killed, then retried — HI-3's timeout doesn't cover "our own process died," only "PagBank hung"). Recommend: `process.on('SIGTERM', async () => { await Promise.all(workers.map(w => w.close())); process.exit(0); })` in `worker/index.ts`, and raise `stop_grace_period` for `worker` specifically in `docker-compose.prod.yml` to comfortably exceed the slowest job type's typical duration (recommend 60s — covers typical NF-e parse; does not need to cover the full 5m hard_ceiling, since BullMQ's stalled-job recovery is the backstop for outliers, not the grace period).

## 3. Connection Management

| Item | Status | Evidence |
|---|---|---|
| DB connection pool sized (not default) | **FAIL** | `grep -r "connection_limit\|pool_timeout" .` — zero matches. `APP_DATABASE_URL`/`DATABASE_URL`/`PLATFORM_ADMIN_DATABASE_URL` in `.env.example` carry no `?connection_limit=N` query param. Prisma's default is `num_physical_cpus * 2 + 1` **per PrismaClient instance**, and this codebase instantiates **three** separate clients per process (`libs/shared/src/db/client.ts`: runtime app client, platform-admin client, and migration client) — `app` and `worker` are separate OS processes, each instantiating its own set. On a VPS with no explicit container CPU limit (see §6), Node's `os.cpus().length` reads the **host's** full core count, not a per-container quota, so the effective pool size scales with host hardware in a way nobody explicitly chose. See `capacity/bottleneck-analysis.md` for the concrete exhaustion math. |
| Redis connection reuse | Pass | `libs/shared/src/queues/index.ts` `redisConnectionOptions()` is called once per queue/worker instantiation using `REDIS_URL`, standard `ioredis`-backed BullMQ connection — no evidence of a new connection per request (rate-limit store and BullMQ share the same Redis, not separate pools). |
| Idle connection timeout | **Not configured** | No `idle_in_transaction_session_timeout` set anywhere (searched `schemas/migrations/`, `.env.example`, `docker-compose.yml`). Postgres default is `0` (disabled) — an app-level bug or a `$transaction` that never commits/rolls back (e.g., an unhandled exception between `lockStockRow()` and the following writes, if not properly wrapped in Prisma's `$transaction` callback rollback semantics) can hold a lock and a connection indefinitely. |
| Connection pool metrics exposed | **FAIL** | No `/api/metrics` endpoint exists (confirmed absent in `services/app/src/app/api/`, and explicitly noted as not-yet-built in `production-deployment.md` §6). Pool saturation (alert #3) currently has no first-party metric to alert on — DevOps would need to poll `pg_stat_activity` externally until this exists. |

**Findings:**
- **[High, NEW]** No `connection_limit` on any of the 3 Postgres roles' connection strings, no `statement_timeout`/`lock_timeout`/`idle_in_transaction_session_timeout` configured anywhere. This is the top capacity/reliability risk surfaced by this review — see `capacity/bottleneck-analysis.md` §1 for the full analysis and `docs/runbooks/postgres-connection-pool-exhaustion.md` (new, this pass) for the operational response. Recommend DevOps add `?connection_limit=10&pool_timeout=10` (or similar, sized per `capacity/scaling-configs.yaml`) to each of the 3 connection strings, and set `statement_timeout` / `lock_timeout` at the role level (`ALTER ROLE app_user SET statement_timeout = '15s'; ALTER ROLE app_user SET lock_timeout = '5s';`) so CR-1's new advisory lock cannot block a connection (and by extension a pool slot) indefinitely under pathological contention.

## 4. Timeout Tuning

| Item | Status | Evidence |
|---|---|---|
| Outbound HTTP calls have timeouts | **CLOSED this session (HI-3)** | `libs/shared/src/payments/providers/pagbank.ts:83` — `AbortSignal.timeout(PAGBANK_REQUEST_TIMEOUT_MS)`. Verified in source, matches `pagbank-webhook-ack-slo` design intent. |
| Global request timeout at ingress | **Unverified** | `deploy/Caddyfile` was not re-read in full this pass beyond production-deployment.md's summary; Caddy's default `reverse_proxy` has no hardcoded timeout unless configured — recommend DevOps confirm `Caddyfile` sets a read/write timeout so a hung upstream `app` request doesn't hold a Caddy connection (and, transitively, a client connection) open indefinitely. |
| Non-idempotent operations not blindly retried | Pass, by design | HI-4's fix makes the PagBank webhook UPDATE itself the idempotency guard (`updateMany` + count), so even if something upstream retries the webhook delivery, the write path is now safe to retry. BullMQ's own job retries (HI-2) apply uniformly to all 4 job types; `parse-nfe`/`import-products-csv`/`scan-expiry-alerts` are naturally idempotent-safe to retry (re-parsing the same file, re-scanning). `generate-monthly-charge`'s job body (`generateMonthlyCharges()`) was not re-read line-by-line this pass to confirm it's safe to retry (i.e., doesn't create a duplicate charge on a partial-failure retry) — **flagging as unverified**, recommend Software Engineer/QA add an explicit idempotency check on this specific job body given it's the highest-stakes retry target per HI-2's own writeup. |
| Postgres statement/lock timeout | **FAIL** | See §3 — no `statement_timeout`/`lock_timeout` configured anywhere. |

## 5. Retry Configuration

| Item | Status | Evidence |
|---|---|---|
| Retries configured with backoff | **CLOSED this session (HI-2)** | `libs/shared/src/queues/index.ts:44-47` — `DEFAULT_JOB_OPTIONS = { attempts: 3, backoff: { type: "exponential", delay: 5000 } }`, wired into all 4 `new Queue(...)` call sites (`worker/index.ts:74,84`, `api/nfe-imports/route.ts:17`, `api/products/import/route.ts:17`). |
| Jitter applied | **Not present** | BullMQ's built-in `exponential` backoff type does not apply jitter by default (no custom backoff strategy function is registered). At this system's scale (single worker, low job volume, MVP), thundering-herd-from-synchronized-retries is a low-probability risk — noting it as a Low finding, not blocking, but worth a one-line fix (`backoff: { type: "custom" }` with a jittered function) if/when job volume grows past what a solo/pair team notices manually. |
| Retry budget capped | Pass | `attempts: 3` is itself the cap — no unbounded retry loop exists. |
| Circuit breaker on repeated failures | **Not present** | No circuit breaker library or pattern found (`grep -r "circuit" services/ libs/` — no matches). At current scale (single external dependency — PagBank — and BullMQ's own retry+backoff already bounding the blast radius to 3 attempts per job with exponential delay), a full circuit breaker is arguably over-engineering for a solo/pair team; the more relevant protection is HI-3's timeout (already closed) plus the alert on webhook error rate (`alerting-thresholds.md` #6). Noting as accepted risk at this scale, not re-opening as a finding. |

## 6. Resource Limits

| Item | Status | Evidence |
|---|---|---|
| CPU/memory limits set per container | **FAIL** | `docker-compose.yml` and `docker-compose.prod.yml` — grepped for `deploy:`, `mem_limit`, `cpus:` — **zero matches in either file**. All 5 containers (`app`, `worker`, `postgres`, `redis`, `caddy`) run with unbounded access to host CPU/RAM. On a single generic VPS (no k8s, no cgroup-based orchestrator enforcing this externally), a single runaway process (e.g., an oversized NF-e XML that gets past the 10MiB size cap from H-3 but is pathologically nested/slow to parse, or a Postgres query with a bad plan) can starve every other container on the same host. |
| PodDisruptionBudget-equivalent | N/A | Single VPS, single replica per service by design (ADR-001) — no meaningful equivalent at this topology. |
| Ephemeral storage limits | **FAIL** | No `tmpfs` size caps, no volume size caps. `uploads_data` (named volume, shared `app`/`worker`) has no size limit — an unbounded number of NF-e/CSV uploads (each capped per-file at 10-20MiB by H-3, but with no *aggregate* cap) will grow until the VPS disk fills. This is the direct mechanism behind chaos scenario 5 (`disk-full-vps.yaml`) and the new `docs/runbooks/disk-cheio-vps.md`. |

**Findings:**
- **[High, NEW]** Zero resource limits configured anywhere in either Compose file. This is a DevOps implementation item (SRE flags it, does not edit `docker-compose*.yml` per this task's constraints), but the concrete recommendation — sized against a realistic VPS tier for this market — is in `capacity/scaling-configs.yaml`.

## 7. Data Safety

| Item | Status | Evidence |
|---|---|---|
| Backup schedule configured | **CLOSED this SHIP pass (T7)** | `scripts/backup-postgres.sh` + documented cron entry (`production-deployment.md` §2, `0 3 * * *`). |
| Backup restoration tested | **Partially** | `scripts/restore-postgres.sh` exists and was `bash -n` syntax-checked by DevOps (production-deployment.md §7), but **not run against a real restore** — no evidence of an actual `pg_dump` → `pg_restore` round-trip having been executed in this environment. This is exactly the gap the skill's "Common Mistakes" table warns about ("RTO/RPO definitions without testing"). Recommend a first real restore drill before go-live, not just a syntax check — see `capacity`/readiness follow-up. |
| Offsite backup | **Explicitly NOT done, by design decision** | production-deployment.md §2: backups live on the same VPS (`./backups`) — protects against logical corruption, not disk/VPS loss. DevOps correctly flagged this as a team/budget decision outside their unilateral authority, not an oversight. **SRE recommendation:** treat "no offsite backup configured" as an open RPO risk — until offsite sync exists, RPO for a full VPS/disk loss is effectively "since the last time someone manually copied `./backups` elsewhere," which is undefined/unbounded. This should be closed before onboarding the first paying customer, not treated as optional polish. |
| Encryption at rest | **Not configured, accepted at this scale** | No LUKS/volume encryption evidenced; standard tradeoff for a budget VPS. Not re-flagging — outside what a solo/pair team on a generic VPS typically implements, and no compliance requirement (LGPD doesn't mandate encryption-at-rest specifically) forces it today. |
| Encryption in transit | Pass | Caddy TLS (Let's Encrypt) terminates all public traffic; internal Docker network traffic (app↔postgres, app↔redis) is unencrypted but confined to the Compose-internal bridge network, not host-exposed (postgres/redis bound to `127.0.0.1` per `docker-compose.yml:13,36`) — reasonable for this topology. |

**Findings:**
- **[Medium, NEW]** Backup restore has never been executed for real, only syntax-checked. Recommend one real drill (`./scripts/backup-postgres.sh` then `./scripts/restore-postgres.sh <the file just produced>` against a disposable copy of the stack) before first paying customer, and record the actual time taken — this becomes the basis for a real RTO number instead of an assumed one.
- **[Medium, carried forward]** No offsite backup destination configured yet (correctly deferred to DevOps/team budget decision, but re-flagging its urgency here since it directly bounds RPO).

## 8. Dependency Resilience

| Item | Status | Evidence |
|---|---|---|
| Timeout on every outbound call | Pass (PagBank, HI-3) / N/A (Postgres/Redis are same-host, not treated as external deps at this topology) | |
| Fallback defined per dependency failure | **Partial** | Rate limiting fails open on Redis error (`services/app/src/lib/rate-limit.ts`, deliberate documented tradeoff per `security-engineer/findings/high.md` H-5 writeup) — a good example of an explicit, reasoned fallback. No equivalent explicit fallback exists for "Redis is down and BullMQ can't enqueue at all" (chaos scenario 3) — the request-time behavior in that case was not traced in this review; recommend confirming whether `POST /api/nfe-imports` etc. return a clean 5xx/503 or an unhandled exception when `queue.add()` fails against a dead Redis. |
| Dependency health not part of liveness | Pass | `healthz` (the one wired into Docker's own healthcheck / restart behavior) does not call out to Postgres or Redis — confirmed by reading the route (not shown above but consistent with `readyz` being the separate, Postgres-only check). This is the correct pattern (liveness ≠ dependency health) already in place. |

---

## Re-verification of T9a's 3 original gaps (`readiness-gaps.md`)

| # | T9a gap | SHIP status | Evidence |
|---|---|---|---|
| 1 | Worker has no `healthcheck` block | **Partially closed.** A healthcheck now exists (`docker-compose.yml:106`), closing the literal "no block" gap. But it's `pgrep`-based liveness only, not the job-consumption signal T9a's alert #2 actually needs — the substantive gap (alert #2 can't be reliably wired) is **still open**. See §1 above and the concrete fix recommended there (heartbeat key). |
| 2 | PagBank retry/timeout policy undocumented by PagBank | **Unchanged — still an accepted assumption**, not something this SHIP pass could close (it depends on PagBank's own docs / a support ticket, not on this codebase). The defensive mitigation (fast-ack + idempotent processing) is now **more solidly implemented** than at T9a time: HI-4's fix (atomic `updateMany` guard) closes a real race in that idempotency mechanism that existed even in the "idempotent-on-paper" design T9a was assuming. Recommend still doing the PagBank sandbox verification before first paying customer — this SHIP pass does not supersede that recommendation. |
| 3 | No PagBank webhook idempotency/dedupe table confirmed | **CLOSED.** `schemas/migrations/0001_init.sql:103` — `gateway_event_id text UNIQUE`. Confirmed present and, per HI-4, the code path that uses it for idempotency is now race-safe (atomic `updateMany`), not just a unique constraint that could still be raced around at the application-logic level. |

## Summary

| Severity | Count | Items |
|---|---|---|
| High | 3 | No SIGTERM/graceful shutdown handling; no DB connection pool sizing / timeout config; no container resource limits |
| Medium | 3 | `readyz` doesn't check Redis; backup restore never executed for real; no offsite backup destination configured |
| Low | 1 | BullMQ retry has no jitter |
| Closed since T9a | 3 (of which 1 partial) | worker healthcheck exists (partial); PagBank dedupe table confirmed + made race-safe; HI-2/HI-3/HI-4/CR-1 all verified in code (not just claimed — see `capacity/hi2-cr1-slo-impact-review.md`) |

None of the High findings above block SHIP at this team's stated scale (solo/pair, <1,000 tenants, standard engagement mode) — they are exactly the class of gap the error-budget policy's freeze mechanism exists to catch in production rather than requiring perfection pre-launch. They are handed off as findings, not fixed directly, per conflict-resolution protocol (DevOps owns `docker-compose*.yml`/Caddyfile edits; Software Engineer owns adding the SIGTERM handler and the `readyz` Redis check). Recommend treating the connection-pool/timeout gap (§3/§6) as the single highest-priority item to close before the first real concurrent-multi-operator customer, since it's the one most likely to surface as a real incident under the exact load pattern CR-1's fix was designed for (concurrent stock writes) — see `capacity/hi2-cr1-slo-impact-review.md`.
