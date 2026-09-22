# High Findings — QA Engineer (Wave B)

## H-1 — Not-found resources return 500 instead of 404 (unhandled Prisma P2025), systemic across `findUniqueOrThrow`/`findFirstOrThrow` call sites

**Status:** Confirmed, reproducible on demand. Violates the explicit, documented
`_common.yaml` NotFound contract ("RLS nunca vaza 403 vs 404" — the API must never leak whether a
resource exists under another tenant) — worse than the violation it exists to prevent, since it
leaks a `500` (and logs an "erro não tratado" alarm) instead of a clean `403`/`404` ambiguity.

**Symptom (reproduced via `tests/integration/rbac.test.ts` and directly via curl):**

```
PATCH /api/stores/<valid-uuid-but-nonexistent-or-other-tenant> -> 500 {"code":"INTERNAL_ERROR"}
```

Confirmed via `docker compose logs app`:

```
Invalid `prisma.store.findUniqueOrThrow()` invocation:
An operation failed because it depends on one or more records that were required but not found.
  code: 'P2025', meta: { modelName: 'Store', cause: 'No record was found for a query.' }
```

**Root cause:** `services/app/src/lib/http.ts`'s `handleRoute()` only maps the app's own `AppError`
hierarchy (`NotFoundError`, `ValidationError`, `ConflictError`, ...) to their HTTP status; any
other thrown error (including Prisma's `PrismaClientKnownRequestError` P2025 from
`findUniqueOrThrow`/`findFirstOrThrow`) falls through to the generic `500 INTERNAL_ERROR` branch.
Since Postgres RLS makes a cross-tenant row invisible rather than absent-with-a-different-owner, a
`findUniqueOrThrow` on ANY RLS-scoped id that belongs to another tenant (or simply doesn't exist)
throws P2025, not a "0 results, tenant mismatch" the app code can distinguish — and nothing catches
it.

**Confirmed call sites using this exact unguarded pattern** (`grep -rn
"findUniqueOrThrow\|findFirstOrThrow" services/app/src/modules`):

| File | Call | Route(s) affected |
|---|---|---|
| `modules/auth/stores.ts:48` | `tx.store.findUniqueOrThrow` | `PATCH /api/stores/{id}` — **reproduced live** |
| `modules/auth/users.ts:25` | `tx.user.findUniqueOrThrow` | `PATCH /api/users/{id}/role` (same shape, not yet reproduced live but same code pattern) |
| `modules/auth/tenant.ts:16` | `tx.tenant.findUniqueOrThrow` | `PATCH /api/tenant` (id is always the caller's own tenant here, lower risk, but still unguarded) |
| `modules/stock/transfers.ts:97` | `tx.batch.findUniqueOrThrow` | `POST /api/transfers` — an attacker/bug supplying a `batchId` from another tenant or a nonexistent id would 500 instead of a clean validation error |
| `modules/billing/subscriptions.ts:32,90` | `tx.tenant.findUniqueOrThrow`, `platformPrisma.plan.findUniqueOrThrow` | `POST /api/billing/subscription`, `PATCH /api/billing/subscription/plan` — an invalid/deleted `planId` 500s instead of 404/400 |

**Impact:** Functional-correctness and API-contract violation across at least 6 call sites in 5
route families. Not classified as a security bypass (no cross-tenant data is returned — RLS itself
is holding; this is purely an error-mapping gap), so filed here as a QA functional-correctness
finding rather than routed to the security track. Operationally it also means every one of these
is logged as an "erro não tratado" alarm-level log line for what is actually a routine,
expected-to-happen client error (wrong id, stale cache, cross-tenant probe) — noise that would
drown out genuine unexpected errors in production monitoring.

**Suggested fix (for the owning build agent):** either (a) add a `catch` in `handleRoute()` (or a
shared Prisma-error-mapping helper) that translates `PrismaClientKnownRequestError` with `code ===
'P2025'` to the app's `NotFoundError` before the generic 500 fallback — the single fix that closes
all 6 call sites at once — or (b) replace each `findUniqueOrThrow`/`findFirstOrThrow` with
`findUnique`/`findFirst` + an explicit `if (!row) throw new NotFoundError(...)`, matching the
pattern already used correctly in `catalog/products.ts:72` (`getProduct`). (a) is recommended:
lower blast radius, fixes future call sites too, and matches the existing "handleRoute translates
errors centrally" design.

**Oracle status:** `tests/integration/rbac.test.ts`'s cross-tenant-404 case is correctly RED
against this bug (fixed a genuine fixture bug alongside it — see `coverage-report.md` test-bug
ledger — the original fixture passed a tenant id where a store id belonged, which was ALSO wrong
but happened to trigger the same real 500).
