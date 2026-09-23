# Bottleneck Analysis — estoque-saas

## Methodology

Pre-launch — no load-test results or production metrics exist yet (see `load-model.md` status
note). Bottlenecks below are identified through: architectural analysis of the actual code
(connection pool defaults, BullMQ concurrency defaults, query shape), the concrete gaps surfaced in
`production-readiness/readiness-review-ship.md`, and the chaos scenarios in `chaos/scenarios/`
designed specifically to empirically validate (or refute) each ranking below. **This document
should be refreshed with real numbers after the first game day run (`chaos/game-day-playbook.md`)
and again after first real production traffic** — both are named, concrete follow-ups, not vague
"revisit later" language.

## Bottleneck ranking (first to saturate)

### 1. Postgres connection pool

- **Current configuration:** no `connection_limit` set on any of the 3 roles' connection strings
  (`app_user`, `platform_admin_role`, and the migration role) — confirmed absent in `.env.example`
  and `docker-compose.yml` (`readiness-review-ship.md` §3). Prisma therefore defaults to
  `num_physical_cpus * 2 + 1` **per `PrismaClient` instance**, and this codebase instantiates 2
  such clients per process (`load-model.md`), across 2 processes (`app`, `worker`).
- **Estimated saturation point:** on an assumed 4-vCPU VPS, default pool sizing alone accounts for
  up to ~36 connections at rest (2 clients × 9 each × 2 processes) against a 100-connection Postgres
  default — leaving headroom that looks comfortable in isolation, but Prisma's pool is a *ceiling*,
  not a guarantee of graceful queuing past it: with no `pool_timeout` set either, behavior under
  actual saturation (queue vs. hang vs. clean error) is **unverified** — this is exactly what
  chaos scenario 2 (`postgres-connection-exhaustion.yaml`) tests empirically.
- **Symptom:** connection timeout errors, request queuing, eventually request hangs if no timeout
  bounds the wait (see readiness-review-ship.md §4 — no Postgres-level `statement_timeout`/
  `lock_timeout` configured either, compounding this).
- **Mitigation:** set explicit `connection_limit`+`pool_timeout` on all 3 connection strings, sized
  against the VPS's actual vCPU count once known (`scaling-configs.yaml` gives concrete numbers);
  set `statement_timeout`/`lock_timeout` at the Postgres role level so a stuck query/lock-wait
  cannot hold a pool slot indefinitely.
- **Cost to fix:** Low (configuration change, no schema/code change) — this is the single highest
  reliability-per-effort fix surfaced by this SHIP pass.
- **Interaction with CR-1 (advisory lock):** a request blocked waiting on
  `pg_advisory_xact_lock` (stock writes on the same product+store) holds its Postgres connection —
  and therefore its pool slot — for the duration of the wait. Under realistic PME concurrency
  (1-5 operators per store, `load-model.md`) this is a non-issue; under a pathological hot-SKU
  contention burst (many concurrent writers to one product+store, e.g. a bulk NF-e import landing
  on the same product being sold live), lock waits without a `lock_timeout` could plausibly turn
  ordinary write contention into pool exhaustion. Chaos scenario 6
  (`stock-lock-contention-hot-sku.yaml`) is the empirical test of exactly this interaction.

### 2. Shared worker process — single concurrency-1 lane per job type

- **Current configuration:** `services/app/src/worker/index.ts` instantiates 4 `new Worker(...)`
  with no `concurrency` option — BullMQ's default is `1`. Each job type (`parse-nfe`,
  `generate-monthly-charge`, `scan-expiry-alerts`, `import-products-csv`) processes strictly one
  job at a time, no matter how many are queued.
- **Saturation point (structural, not load-dependent):** any two jobs of the **same type**
  queued simultaneously wait behind each other regardless of VPS headroom — this is a design
  ceiling, not a resource ceiling. At 1x scale (BRD target, ~1,000 tenants) this is invisible
  because job volume is low and jobs are short. At 10x+ (`load-model.md`), the daily
  `scan-expiry-alerts` job's single-threaded per-tenant loop becomes a real wall-clock risk (8-33
  minutes at 10x, by estimate) — and because ALL 4 job types share the same worker **container**
  (not just the same process budget conceptually — literally the same `docker-compose.yml` service,
  competing for the same CPU/DB-connection allocation), a long-running `scan-expiry-alerts` run
  does not block `parse-nfe`/`generate-monthly-charge` at the BullMQ level (different queues, each
  with their own Worker instance) but DOES compete with them for the shared container's CPU and,
  more importantly, for the shared Postgres connection pool (§1) — a burst of NF-e imports landing
  during the daily scan window will contend for the same limited connection budget.
- **Symptom:** growing `waiting` count in `alerting-thresholds.md` alert #4, specifically the
  `alerts` queue given its 60s SLA is the least tolerant of this ceiling.
- **Mitigation:** raise `concurrency` on the `parse-nfe` and `import-products-csv` Workers first
  (these are the most naturally parallelizable — independent tenants' imports don't interact) once
  real volume data justifies it; `generate-monthly-charge` and `scan-expiry-alerts` are safer left
  at concurrency 1 per queue given they already loop internally over tenants and increasing
  concurrency there would mean concurrently processing the SAME job type's cross-tenant logic,
  which needs its own review before parallelizing (risk of amplifying §1's connection pressure, not
  reducing wall time, if not done carefully).
- **Cost to fix:** Low now (a `Worker` constructor option) — becomes a real architecture decision
  (ADR-001's own extraction plan already anticipates this, billing/NF-e-parsing are explicitly
  named as the first candidates) past 10x scale.

### 3. Uploads volume — unbounded aggregate disk growth

- **Current configuration:** `uploads_data` named volume (shared `app`/`worker`) has a per-file cap
  (10/20 MiB, H-3) but **no aggregate size cap and no retention/cleanup policy** — confirmed absent
  from `docker-compose.yml`/`docker-compose.prod.yml` and no cleanup job found in `worker/index.ts`.
- **Saturation point:** directly a function of upload volume × time, with no ceiling — at 1,000
  tenants uploading a modest number of NF-e XMLs/month each, this grows slowly; the real risk is
  the SAME single disk also holds `postgres_data` (§4 below) and Docker's own image/log storage,
  so uploads growth is not an isolated concern — see `chaos/scenarios/05-disk-full-vps.yaml`.
- **Mitigation:** either a retention policy (delete/archive uploaded files N days after successful
  parse, once the parsed data is durably in Postgres and the raw XML is no longer needed for
  anything but audit purposes — confirm against ADR-005/ADR-007's audit requirements before
  deleting anything) or moving upload storage off the VPS's primary disk (a second volume, or the
  S3-compatible storage backend `c4-container.md` already names as the intended prod target but
  notes is not yet implemented — `File Storage` container description: "Volume local (dev) /
  S3-compatible (prod)").
- **Cost to fix:** Low-Medium (retention job is a straightforward addition to the worker; moving to
  S3-compatible storage is a bigger but already-anticipated architectural step).

### 4. Postgres data growth — `stock_movements` and `audit_log`

- **Current configuration:** both tables are pure-insert, append-only ledgers by design (ADR-007
  for `audit_log`; `stock_movements` is the authoritative derived-balance ledger per
  `balance.ts`'s own comments) — **no partitioning, no archival strategy found** in
  `schemas/migrations/`.
- **Growth rate estimate (architectural, not measured):** every stock-mutating operation writes
  exactly one `stock_movements` row (plus one `audit_log` row per audited action, which includes
  stock movements and more — RBAC changes, billing events, etc. per ADR-007). At 1,000 tenants with
  an assumed modest 20-50 stock movements/day/tenant (PME retail, not high-frequency e-commerce),
  that's ~20,000-50,000 new `stock_movements` rows/day, or roughly 7-18 million rows/year at 1x
  scale — each row is small (a handful of columns), so this is a manageable growth rate for a
  single Postgres instance at 1x, but the *query* cost is the earlier concern (§1/§2's `DISTINCT
  ON` scans get more expensive as row count per product grows, even with the existing index
  support) more than raw disk size at this scale.
- **Saturation point:** disk growth alone is not the near-term bottleneck at 1x (§3's uploads
  volume and §1's connection pool saturate first); becomes a real concern at 10x+ where both row
  count AND concurrent query volume against those rows both grow, compounding.
- **Mitigation:** none needed urgently at 1x. Before 10x: consider whether `stock_movements`
  needs a covering index tuned specifically for the `DISTINCT ON (product_id, store_id) ORDER BY
  created_at DESC` access pattern HI-1's batched query relies on (confirm query plan doesn't
  degrade as row count grows — this wasn't verified in this pass, flagging as a follow-up), and
  whether `audit_log`'s immutability (C-2, `REVOKE UPDATE, DELETE`) needs a partitioning strategy
  for long-term retention/compliance (LGPD data-retention questions are a Product/Legal decision,
  not something SRE resolves unilaterally here — flagging the operational trigger point only).
- **Cost to fix:** Low now (monitor and revisit); Medium at 10x+ (partitioning is a real migration).

## Bottlenecks explicitly ruled out at current/1x scale

- **Redis** — used for BullMQ queues, rate-limiting, and session/query cache, but at 1x volume none
  of these three concerns approaches Redis's default memory ceiling on any reasonable VPS tier;
  the real Redis risk at this scale is availability (single instance, no failover — chaos scenario
  3), not capacity.
- **CPU** — no evidence of any CPU-bound hot path (XXE-safe XML parsing per C-5, no unbounded
  computation found) that would saturate before the connection-pool/worker-concurrency ceilings
  above. Revisit if/when large-batch NF-e parsing becomes measurably CPU-heavy in practice.
