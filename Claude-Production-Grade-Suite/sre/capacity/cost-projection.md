# Cost Projection — estoque-saas

**Topology reminder:** single generic VPS, Docker Compose, no managed cloud services (ADR-001/003)
— this is a much simpler cost model than a cloud-native stack, deliberately. No load balancer,
no managed database, no CDN spend, no per-request billing to project.

## 1x (BRD year-1 target, ~1,000 tenants)

| Line item | Estimate | Basis |
|---|---|---|
| VPS (app+worker+postgres+redis+caddy, single box) | 1 mid-tier VPS (4 vCPU / 8GB RAM class) | `scaling-configs.yaml` assumption; a generic budget/mid-tier VPS provider in this class is commonly in the low tens of USD/month — **exact pricing not verified here** (Tier 2 freshness item per protocol — DevOps should verify current pricing from their chosen provider at actual provisioning time, not from this document) |
| TLS certificates | $0 | Caddy + Let's Encrypt, automatic (`production-deployment.md` §1) |
| Backup storage (on-VPS) | $0 incremental | Same disk, `./backups` (`production-deployment.md` §2) — **this is exactly why offsite backup is a real line item to budget for, not free**, see below |
| Offsite backup storage (NOT yet configured — see readiness-review-ship.md §7) | Small (a few GB/month of compressed `pg_dump` output, object storage pricing is typically cents/GB/month) | Recommend budgeting this explicitly rather than leaving it implicitly deferred — the gap is a decision-cost, not a technical blocker |
| Domain + DNS | Nominal (few USD/year) | Standard |
| **Total infra** | **Single small monthly VPS bill + nominal domain cost** | This is the entire infrastructure cost surface at 1x — no managed-service line items exist by design |

**Cost optimization at 1x:** none needed — the topology is already minimal by design (ADR-001's
explicit rejection of microservices/managed services at this stage). The only real "optimization"
available is picking a VPS tier that matches `scaling-configs.yaml`'s resource assumptions rather
than over- or under-provisioning relative to them.

## 10x (~10,000 tenants)

| Line item | Estimate | Basis |
|---|---|---|
| VPS | Upgrade to a larger single-box tier (more vCPU/RAM) OR split `postgres`+`redis` onto a
second box from `app`+`worker` | `bottleneck-analysis.md` — connection pool and worker-concurrency
ceilings become real at this scale; a bigger single box buys time without an architecture change,
but is a stopgap, not a long-term fix |
| Read replica (if query load, not just connection count, becomes the bottleneck) | Managed Postgres
read-replica pricing, OR a self-managed replica on a second VPS | Only justified if
`bottleneck-analysis.md` §1/§4's query-cost concern materializes in real metrics — do not
provision preemptively |
| Offsite backup storage | Proportionally larger (still small relative to compute cost) | Linear
with data volume |
| **Total infra** | **Meaningfully higher than 1x, but still a small number of infrastructure
line items** — this scale does not yet require the extraction plan ADR-001 anticipates | |

## 100x (~100,000 tenants)

At this scale, per ADR-001's own extraction plan, the single-VPS/single-Postgres topology is no
longer the right architecture, and a cost projection built on "more of the same VPS" would be
misleading rather than useful. The concrete trigger (per ADR-001: ">15 pessoas no time, ou
necessidade de escalar um módulo isoladamente") is an architecture decision for Solution Architect
to own if/when it's reached, not a configuration/capacity-planning exercise SRE can responsibly
project cost for today. **Flagging this explicitly rather than fabricating a speculative cloud
cost breakdown for an architecture that doesn't exist yet.**

## Recommendation

Revisit this document with real numbers once: (a) a VPS is actually provisioned and its real
pricing/spec is known (closes the assumption flagged throughout `load-model.md`/
`scaling-configs.yaml`), and (b) offsite backup storage is actually configured (closes the one
real gap in the 1x cost model above).
