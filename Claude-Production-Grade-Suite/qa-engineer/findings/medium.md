# Medium Findings — QA Engineer (Wave B)

## M-1 — `auth.config.ts` `pages.signIn` points at a route that no longer exists (`/login` vs real `/entrar`)

**File:** `services/app/src/modules/auth/auth.config.ts:32` — `pages: { signIn: "/login" }`.

The actual login page is `/entrar` (`services/app/src/app/entrar/page.tsx`) — `/login` returns a
404 (no such route in the app). The unauthenticated-redirect gate that actually protects the app is
`services/app/src/proxy.ts`'s own custom check (redirects to `/entrar` directly, per its own
comment explicitly citing boundary-safety Pattern 2 — "não duplicar o control flow do
framework... mas apontar para a própria página de login, nunca para uma rota de callback"), so this
stale `pages.signIn` value is NOT currently reachable through the primary auth-guard path and no
user-facing break was reproduced. It IS reachable through any NextAuth-internal flow that falls
back to its own default sign-in redirect (e.g. certain error states inside the
`/api/auth/nextauth-internal/[...nextauth]` catch-all) — not exhaustively tested here, filed as a
real but currently-dormant inconsistency rather than a reproduced break. Low effort, high-confidence
fix: change to `pages: { signIn: "/entrar" }` to match the real route.

## M-2 — Duplicate `Plan` rows are trivially creatable and already accumulating in the dev database

Not a code defect — `POST /api/plans` doesn't exist (plans are seeded, not user-created) — but
`scripts/seed-plans.mjs` and this QA pass's own `seedPlan()` test fixture both insert rows with no
uniqueness constraint on `name`, and the live dev database (as of this pass) already has 9+ rows
named "Básico" with varying limits (verified via `GET /api/plans`). This makes any UI flow that
selects a plan BY NAME (e.g. an E2E test, or a support script) ambiguous. Filed as Medium because
it is a real, currently-observable data-quality issue in the shared dev environment (not
production), and because `tests/e2e/ui/pages/signup.page.ts` had to be written defensively
(`selectPlan()` picks the first matching card rather than assuming a unique name) specifically to
avoid breaking on this. No code change strictly required; consider a unique index on `(name)` or a
`slug` column if Plans are meant to be a small, curated, named catalog (three plans per
`docs/architecture` — Básico/Pro/Enterprise), or simply document that `seed-plans.mjs` is
idempotent-by-id, not by name, and re-running it is expected to create duplicates.
