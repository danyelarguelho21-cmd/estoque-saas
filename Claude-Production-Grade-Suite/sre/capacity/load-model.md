# Load Model — estoque-saas

**Status: pre-launch.** There is no production traffic yet — this is architectural/theoretical
modeling, not a fit to measured Prometheus data (none exists — `production-deployment.md` §6
confirms no `/api/metrics` endpoint or monitoring stack is deployed yet). Every number below is
either derived from the architecture/code (defaults, schema, query shape) or explicitly marked as
an assumption. **Do not treat the "measured" columns as real until this doc is refreshed against
actual traffic post-launch** — that refresh is a concrete, named follow-up, not implied.

**Scale unit:** this business scales with **tenant count** (PME retail, BRD target <1,000
tenant companies year 1 — `sli-definitions.yaml` header), not raw RPS in the way a consumer
product would. All projections below are anchored to tenant count first, RPS second.

## Current baseline (pre-launch — architectural estimate)

| Metric | Value | Basis |
|---|---|---|
| Concurrent operators per tenant (assumption) | 1-5 | PME retail — a small store with a handful of staff (vendedor/operador roles) using the system simultaneously during business hours; this is the realistic contention unit for CR-1's advisory lock, not "thousands of concurrent users." |
| Postgres `max_connections` | 100 | `postgres:18-alpine` image default — confirmed no override in `docker-compose.yml`/`.env.example` (readiness-review-ship.md §3). |
| Prisma default pool size per `PrismaClient` | `num_physical_cpus * 2 + 1` | Prisma's documented default when no `connection_limit` is set (confirmed absent — readiness-review-ship.md §3). |
| `PrismaClient` instances per process | 2 (app-runtime client + platform-admin client, `libs/shared/src/db/client.ts`) | Both `app` and `worker` processes instantiate the app-runtime client; the platform-admin client is used by `modules/admin/*` in `app` and by `modules/billing/*` (plan lookups) in both `app` and `worker` per code-reviewer HI-5's file list. |
| BullMQ worker concurrency | **1 per queue** (BullMQ default, not overridden) | `services/app/src/worker/index.ts` — none of the 4 `new Worker(...)` calls pass a `concurrency` option. This means each of the 4 job types (`parse-nfe`, `generate-monthly-charge`, `scan-expiry-alerts`, `import-products-csv`) processes **exactly one job at a time**, regardless of how many are waiting — a structural throughput ceiling independent of CPU/RAM. |
| NF-e import size | up to 10 MiB per file (H-3 cap) | `libs/shared/src/storage/index.ts` `MAX_NFE_UPLOAD_BYTES` |
| CSV import size | up to 20 MiB per file (H-3 cap) | `MAX_CSV_UPLOAD_BYTES` |

## Request fan-out (per user action, traced from route handler to data layer)

| User action | Route | DB queries | Redis ops | Queue messages |
|---|---|---|---|---|
| Register stock entry | `POST /api/stock/entries` | 1 advisory lock (`pg_advisory_xact_lock`) + `getCurrentStock` (1 `DISTINCT ON` query) + 1 `INSERT` into `stock_movements` + 1 `audit_log` insert, all inside one `withTenant` transaction | 0 | 0 | 3-4 total statements, 1 transaction |
| Register sale (FEFO) | `POST /api/sales` | Batch resolution (`resolve-batches.ts`) + lock + balance check + `INSERT` sale + `INSERT` stock_movements per line + audit_log — scales with line-item count (N items ≈ 2N+2 queries, all in one transaction) | 0 | 0 | 1 transaction, N-dependent query count |
| NF-e upload | `POST /api/nfe-imports` → async | 1 `INSERT nfe_imports` (status `pending`) | 0 | 1 (`parse-nfe`) | Parsing itself (worker) then does M queries where M ≈ line-item count of the XML — "centenas de itens" per ADR-005, i.e. potentially 100s of queries in a single worker job, processed with concurrency 1 |
| Low-stock alerts list (pre-HI-1 fix) | `GET /api/stock/alerts` | **O(n) in catalog size** before HI-1's batching fix | 0 | 0 | Fixed this session — see `capacity/hi2-cr1-slo-impact-review.md` cross-reference; now O(1) queries via `getCurrentStockForProducts` |
| PagBank webhook | `POST /api/webhooks/pagbank` | 1 signature check (no DB) + enqueue | 0 | 1 (billing queue) | Ack is synchronous-fast by design (ADR-004); reconciliation happens in the enqueued job |
| Daily `scan-expiry-alerts` job | (scheduled, 07:00) | Per-tenant: batched (post-HI-1) queries for expiring batches + low-stock, O(1) per tenant instead of O(products) | 0 | 0 | Runs for **every active tenant, sequentially, in one worker process with concurrency 1** — this is the single most tenant-count-sensitive path in the system (see bottleneck-analysis.md §3) |

## Growth projections (by tenant count, the real scale axis for this business)

| Scale | Tenants | Concurrent writers (assumption: 2 per tenant during business hours, staggered) | Postgres connections (Prisma default sizing, 4 vCPU VPS assumed) | Daily `scan-expiry-alerts` wall time (assumption: ~50-200ms/tenant post-HI-1 batching) | First bottleneck |
|---|---|---|---|---|---|
| Current (pre-launch) | 0 | 0 | ~18 at rest (pool allocation, not active load) | N/A | — |
| 1x (BRD year-1 target) | ~1,000 | ~50-100 at any instant, spread across the day | Same pool ceiling (~18-36, see `bottleneck-analysis.md` §1) but **contention risk rises sharply** past a few dozen truly concurrent writers | ~50-200s total (1,000 × 50-200ms), single-threaded, sequential — **comfortably inside the job's own daily schedule window, no SLO risk yet** | Postgres connection pool (see §1 below), not the scan job itself |
| 10x | ~10,000 | ~500-1,000 at any instant | Pool ceiling unchanged (config doesn't auto-scale) — **exhaustion becomes a real, frequent event**, not a tail risk | ~500-2,000s (8-33 minutes) — **starts to threaten the `job-alert-scan-slo`'s implicit "runs once a day and finishes" assumption**, though the SLO itself is about the 60s-per-movement freshness bound, not total job wall time, so this needs a design change (partition the daily scan) before 10x, not just a bigger VPS | Both Postgres connections AND the single-threaded daily scan job become simultaneous bottlenecks |
| 100x | ~100,000 | ~5,000-10,000 at any instant | Single-VPS/single-Postgres topology (ADR-001) is **no longer viable as-is** — this is explicitly the trigger ADR-001's extraction plan anticipates ("se a escala justificar"), not a tuning problem | Single-threaded daily scan (~1.4-5.6 hours) is now itself an incident, not a tail risk | Architecture, not configuration — read replicas / worker horizontal scaling / billing module extraction (ADR-001's own stated extraction order) become required, not optional |

**Assumption flag:** the "4 vCPU VPS" used for the Prisma pool-size estimate above is not confirmed
anywhere in the architecture docs (`tech-stack.md`/ADR-001/ADR-003 say "generic VPS," no spec).
This is a reasonable mid-tier assumption for this product's budget profile, not a verified number —
recommend DevOps record the actual provisioned VPS spec in `production-deployment.md` once a real
VPS is chosen, and this document should be refreshed against the real number at that point.

## Seasonal / temporal patterns

- **Daily:** two scheduled jobs create predictable load spikes independent of user traffic:
  `generate-monthly-charge` at 06:00 and `scan-expiry-alerts` at 07:00 (`worker/index.ts:79,89`).
  Both run with concurrency 1, so neither competes with the other for worker capacity (different
  queues, but BullMQ workers process independently) — however both DO compete with any
  user-triggered NF-e/CSV import jobs for the same shared worker process's CPU/DB-connection
  budget, since all 4 job types run in the same container.
- **Monthly:** `generate-monthly-charge` is explicitly a burst — "all due-date charge generations
  queued at the same cron tick" per `docs/runbooks/worker-queue-backlog-growing.md` Step 3 — this
  is a known, designed-for burst shape, not an anomaly, as long as PagBank's own API can absorb a
  burst of charge-creation calls (HI-3's 10s timeout bounds each individual call, but does not
  bound the total wall time of N sequential calls in a burst — see `bottleneck-analysis.md` §3).
- **No weekly/holiday pattern is known yet** — genuinely unknown pre-launch, not omitted by
  oversight. Revisit once real usage data exists.
