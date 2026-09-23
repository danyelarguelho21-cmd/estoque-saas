---
name: local-dev-stack-bootstrap
description: Use when you need a working local integration environment for estoque-saas outside full Docker Compose — app+worker as local processes against test/dev Postgres+Redis containers, debugging integration tests, or reproducing an upload/NF-e/webhook bug locally. Also use when local runs fail with EACCES on uploads, unexpected 401s, or Redis rate-limit errors during test loops.
---

# Local Dev Stack Bootstrap

## Overview

estoque-saas's dependencies (Postgres, Redis) run in containers, but app+worker are two
separate Node processes that both need to point at the SAME database/Redis/uploads directory
with a handful of non-default settings. Getting this wrong produces confusing failures (EACCES
on upload, silent 401s, rate-limit lockouts) that look like application bugs but are environment
mismatches. This skill is the known-good sequence, derived from actually debugging each of these
failure modes this session.

## The Sequence

### 1. Bring up dependency containers (test ports, not dev ports, if running alongside `make up`)

```
npm run test:qa:integration:up   # postgres-test:5433, redis-test:6380 (tests/integration/docker-compose.test.yml)
# or, for the dev-named stack instead:
make up                          # postgres:5432, redis:6379 (root docker-compose.yml) -- also starts app/worker in Docker
```

Never point local `app`/`worker` processes at the SAME Postgres the Docker-composed `app`
service also writes to unless that's intentional — prefer the `test` containers (non-default
ports 5433/6380) to keep dev data untouched (this is the exact reason
`docker-compose.test.yml` exists as a separate file from `docker-compose.yml`).

### 2. Apply the FULL migration chain — not just `prisma migrate`

`prisma migrate` alone does not create `app_user`/`platform_admin_role` or apply RLS policies —
those come from the hand-maintained SQL in `schemas/migrations/` via
`scripts/apply-role-grants.mjs` (see `Makefile`'s `migrate` target, which chains all three):

```
make migrate     # prisma migrate + apply-role-grants.mjs + seed-plans.mjs, in that order
```

Skipping `apply-role-grants.mjs` reproduces the exact bug `db-test-helpers.ts`'s comment
documents: `APP_DATABASE_URL`/`platformPrisma` connect as `app_user`, a role that plain `prisma
migrate` never creates — every request fails "Authentication failed... app_user".

### 3. Set matching env vars for BOTH app and worker

Both processes MUST share the same `UPLOADS_DIR` (worker's async NF-e/CSV parse job reads the
file `app`'s upload handler wrote — see `docker-compose.yml`'s `uploads_data` volume comment).
Running app/worker as local processes (not Docker), the default relative `UPLOADS_DIR=./.data/uploads`
is fine AS LONG AS both are launched from the same working directory — a mismatch here is the
local-process equivalent of the EACCES bug Docker hit (there it was a non-writable directory;
locally it's usually "worker can't find the file app wrote").

```
# .env (copy from .env.example) -- key vars for local process mode:
APP_DATABASE_URL=postgresql://app_user:devpassword-app-user@localhost:5433/estoque_saas_test?connection_limit=10&pool_timeout=10
REDIS_URL=redis://localhost:6380
UPLOADS_DIR=./.data/uploads
```

`connection_limit`/`pool_timeout` query params are not optional flourishes — Prisma's default
pool size is `num_cpus*2+1` PER CLIENT with no cap (SRE finding, T9b); set them explicitly even
outside Docker or the pool sizing silently depends on the host's core count.

### 4. Raise rate-limit thresholds for integration-test-style loops

`services/app/src/lib/rate-limit.ts` has safe production defaults on `/api/auth/login`,
`/api/auth/signup`, `/api/platform-admin/login` (Redis-backed, per-IP and per-email). A local
integration run that calls `signUpAndLogin()` (see `tests/fixtures/http-test-client.ts`) dozens
of times from the same IP WILL hit these. Override only for this local/test environment, never
in a real `.env`:

```
RATE_LIMIT_LOGIN_IP_MAX=20
RATE_LIMIT_SIGNUP_IP_MAX=5
# full list of overridable vars: see .env.example's "Rate limiting" section
```

### 5. Start app and worker as two separate processes

```
npm run dev      # services/app dev server, port 3000 (or TEST_BASE_URL's port if running against the test stack, default 3100 per http-test-client.ts)
npm run worker    # separate process -- BullMQ workers for NF-e parse, billing, expiry-scan jobs
```

Forgetting `npm run worker` is a common silent failure: uploads accept (200/201) but never
finish processing, because the async parse job has no worker consuming its queue.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Only running `npm run dev`, not `npm run worker` | Async jobs (NF-e parse, billing sync, expiry-scan) need the worker process running separately |
| `prisma migrate` without `apply-role-grants.mjs` | Use `make migrate` (chains all three steps) — `app_user`/RLS policies come from `schemas/migrations/`, not Prisma |
| app and worker launched with different `UPLOADS_DIR`/CWD | Launch both from the repo root with the same `.env` so relative `UPLOADS_DIR` resolves identically |
| Pointing local processes at the Docker `app` service's own Postgres | Use the `-test` containers (5433/6380) for local process work unless intentionally sharing dev data |
| Hitting rate limits during a manual test loop | Set the `RATE_LIMIT_*_MAX`/`_WINDOW_MS` overrides from `.env.example` for this environment only |
| Omitting `connection_limit`/`pool_timeout` on local `APP_DATABASE_URL` | Always include them — see SRE capacity finding in `.env.example`'s `APP_DATABASE_URL` comment |
