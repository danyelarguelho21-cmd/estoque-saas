# Error Budget Policy — estoque-saas

**Authority:** SRE (sole owner of this policy — see `.protocols/conflict-resolution.md`). DevOps implements the monitoring that measures it; DevOps does not change the thresholds or consequences below.

**Audience:** a 1-2 person team. This policy is deliberately lightweight — no war rooms, no separate release-management board, no quarterly budget-review committee. It exists to answer one question in plain terms: **"is it time to stop building features and go fix reliability?"**

---

## 1. How the budget is calculated

Error budget = `1 - SLO target`, measured over the SLO's rolling window (30 days, see `sli-definitions.yaml`).

Example: `web-core-availability-slo` target is 99.5% over 30 days → error budget is 0.5% of requests, or equivalently ~3h36m of allowed downtime-equivalent per rolling 30-day window.

Budget is **rolling**, not calendar-reset. A bad day 29 days ago ages out of the window naturally — there is no "reset meeting."

## 2. Budget consumption thresholds and actions

| Remaining budget | Applies to | Action |
|---|---|---|
| **> 50%** | Any SLO | Normal operation. Ship features normally. |
| **50% → 20%** | `web-core-availability-slo`, either latency SLO, either job SLO | **Yellow flag.** Note it in the next work session. Prioritize the top reliability-related bug/tech-debt item in the next sprint alongside feature work — not instead of it. No freeze yet. |
| **50% → 20%** | `pagbank-webhook-availability-slo` or `pagbank-webhook-ack-slo` | **Yellow flag, billing-specific.** Same as above, but treat webhook/billing reliability work as the #1 priority item next sprint, not just "top of the list" — the blast radius (customer lockout / free-riding non-payers) is disproportionate to a small team's ability to do manual damage control at scale. |
| **< 20%** | `web-core-availability-slo` | **Freeze.** Stop shipping new customer-facing features. All engineering time goes to reliability work (bug fixes, the specific incidents that burned the budget, monitoring/alerting gaps) until budget recovers above 20% remaining OR a full rolling window passes with no further burn. |
| **< 20%** | `pagbank-webhook-availability-slo` or `pagbank-webhook-reconciliation-slo` | **Billing-scoped freeze.** Freeze changes to the `billing` module specifically (per ADR-001 module boundaries) until resolved. Other modules (catalog, stock, sales) are not blocked unless their own budget is also low. |
| **Any single hard_ceiling breach** on `job-alert-scan-latency` or `job-billing-charge-generation-latency` | — | Treated as an **immediate incident**, not a budget-tracking event — see rationale in `sli-definitions.yaml` (these map to a hard BRD acceptance criterion and to real billing risk respectively, regardless of where the rolling SLO stands). |
| **`web-dashboard-availability-slo` at any level** | — | Tracked and reported, but **never triggers a freeze on its own**. Dashboards are explicitly staleness-tolerant per BRD. If you're tempted to freeze feature work over a dashboards-only budget burn, don't — fix it in the background instead. |

## 3. Who has authority to freeze / unfreeze

With a 1-2 person team there is no separate approval chain. Whoever is doing the work is the one who calls the freeze — this policy exists precisely so that call doesn't have to be improvised under pressure. If the team grows past 2-3 engineers, revisit this section and name an explicit decision-maker (likely the technical co-founder / eng lead) before the ambiguity becomes a real problem.

**Practical rule:** if you're asking "should I be worried," check the budget-remaining number, not your gut. That's the entire point of having one.

## 4. Emergency deployment exception (during a freeze)

A freeze does not mean "no deploys." It means "no new customer-facing feature work." The following are always allowed during a freeze, no extra approval needed:

- Security fixes (any severity — see Security Engineer's findings/threat model).
- Fixes to the specific incident(s) that caused the freeze.
- Billing-correctness fixes — anything where a bug would cause a paying customer to lose access, or a non-paying customer to keep it (direct revenue/BRD risk, Epic 9).
- Fixes to cross-tenant data isolation (RLS) issues — see `docs/runbooks/postgres-rls-misconfiguration-cross-tenant-leak.md`. These are never subject to a feature freeze; they ARE the top-priority reliability work regardless of budget state.

Anything else waits until the freeze lifts.

## 5. How the budget resets / recovers

Rolling window (30 days) — the budget naturally recovers as old bad events age out, provided no new burn occurs. There is no manual "reset." If the team wants a harder reset trigger (e.g., a documented postmortem closing out a specific incident), that can be added later — not needed at this scale/team size today.

## 6. What this policy deliberately does NOT include (and why)

- **No PagerDuty/on-call rotation policy** — one or two people; "on-call" is "whoever is awake." Formal rotation is premature at this stage (see production-readiness note in `Claude-Production-Grade-Suite/sre/production-readiness/findings.md`).
- **No executive/leadership review step** — the team IS leadership at this stage.
- **No separate SLO-per-tenant / per-customer-tier budgets** — BRD plans list Básico/Pro/Enterprise, but there's no evidence yet of differentiated reliability commitments per plan. If a future Enterprise plan promises a contractual SLA, that becomes a new, separate SLO with its own budget — do not silently fold it into these.

These omissions are intentional, not gaps — re-add them when the team or customer base actually needs them, not preemptively.
