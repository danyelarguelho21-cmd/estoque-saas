# Low Findings — QA Engineer (Wave B)

## L-1 — Cross-tenant login match order is undefined when the same email+password pair exists in more than one tenant

`schemas/migrations/0004_auth_lookup_function.sql` / `0009_auth_lookup_tenant_name.sql`
(`auth_lookup_user_by_email`) has no `ORDER BY`, and the login flow (per its own doc comment)
"tenta autenticar contra cada uma até achar a senha correta" when an email exists in multiple
tenants. This is an explicitly documented, deliberate design choice (email is unique only per
`(tenant_id, email)`, not globally), not a bug — but it does mean that if two different tenants
happen to have a user with the same email AND the same password (a real, if unusual, scenario —
e.g. two companies onboarded by the same reseller using boilerplate credentials), which tenant's
session the user lands in is arbitrary/row-order-dependent rather than deterministic. Reproduced
incidentally during this QA pass (not as an attack — as a test-fixture pollution artifact: repeated
runs of an earlier version of `tests/integration/rbac.test.ts` against the shared dev database,
before it was fixed to use randomized emails, left 4 rows for `operador@example.com` across 4
tenants, and a subsequent login for that email non-deterministically authenticated against a STALE
tenant from an earlier run instead of the current test's fresh one). No user-facing impact
identified for the realistic case (distinct companies practically never share both email AND
password), so filed as Low/informational rather than requiring a fix — flagging in case a future
feature (e.g. "forgot password", audit trail correlation) assumes login resolution is
deterministic.

## L-2 — `k6` performance suite still unexecuted (environment gap, not a code defect)

`tests/performance/*.k6.js` (3 scripts, thresholds, baselines) were authored in Wave A and remain
unexecuted in this pass — no `k6` binary is available in this environment. Not re-verified this
session; carried forward from the Wave A risk register. Recommend running
`tests/performance/load-tests/*.k6.js` against the live stack in an environment with `k6`
installed (`choco install k6` / `winget install k6.k6` on this Windows host, or via Docker
`grafana/k6`) before treating the dashboard/sales-checkout endpoints' latency as validated at any
load. Scripts + thresholds are ready to run as-is against `http://localhost:3000`.
