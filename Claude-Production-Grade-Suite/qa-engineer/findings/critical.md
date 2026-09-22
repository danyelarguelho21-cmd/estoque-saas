# Critical Findings — QA Engineer (Wave B)

Findings from running the Wave A acceptance oracle (`tests/`) for real against the live Docker
stack (`docker compose up -d` — Postgres 18, Redis 7, app, worker, all healthy). Each finding
below is reproduced independently of the automated suite (curl / Node fetch script + `docker
compose logs`), not just inferred from a failing assertion.

---

## C-1 — NF-e import is completely non-functional in the real deployment (EACCES on file storage)

**Status:** Confirmed, reproducible on demand. Breaks BRD AC-001 (the BRD's own highest-priority,
most explicit acceptance criterion) end-to-end.

**Symptom:** `POST /api/nfe-imports` returns `500 {"code":"INTERNAL_ERROR"}` for every upload,
authenticated, correctly-authorized, well-formed multipart request.

**Root cause** (confirmed via `docker compose logs app`):

```
[handleRoute] erro não tratado (trace_id=...): Error: EACCES: permission denied, mkdir './.data'
    at async Object.save (...)
    at async ... (services_app_src_modules_stock_index_ts...)
  errno: -13, code: 'EACCES', syscall: 'mkdir', path: './.data'
```

`libs/shared/src/storage/index.ts` (`LocalStorage`, used by `uploadNfeImport` in
`services/app/src/modules/stock/nfe-import.ts`) defaults to a **relative** path:

```ts
constructor(private readonly baseDir: string = process.env.UPLOADS_DIR ?? "./.data/uploads") {}
...
await mkdir(this.baseDir, { recursive: true });
```

`services/app/Dockerfile` builds a multi-stage image with `WORKDIR /repo`, copies the built app in
as the default (root) user, then switches to `USER app` (non-root, `addgroup -S app && adduser -S
app -G app`) for runtime. `npm run start --workspace services/app` runs with CWD
`/repo/services/app`, so `./.data/uploads` resolves to `/repo/services/app/.data/uploads` — a path
owned by root, inside a directory the non-root `app` user has no write access to, and which no
volume in `docker-compose.yml` provisions or pre-creates with correct ownership. `UPLOADS_DIR` is
never set in `docker-compose.yml`'s `app`/`worker` service `environment:` block either.

**Reproduced independently of `tests/`** (Node fetch script driving the exact HTTP contract): fresh
signup → login → create store → multipart upload of a valid `nfeProc` XML → `500` every time.
Also reproduced through the real browser via
`tests/e2e/ui/flows/nfe-import-journey.spec.ts` (Playwright/Chromium against the same running
stack) — the upload silently fails client-side and the UI never reaches the review screen.

**Blast radius:** `POST /api/nfe-imports` only (confirmed via `grep -rn "storage\.(save|read)"` —
`services/app/src/modules/stock/nfe-import.ts` is the only caller of the `LocalStorage` adapter;
the CSV product importer parses in-memory and is unaffected).

**Impact:** The single most-cited BRD acceptance criterion (AC-001 — "o sistema lista os itens da
nota, sinaliza produtos não cadastrados, e só grava a entrada em estoque após confirmação explícita
do operador") is 100% unreachable in the actual deployed environment. Every downstream step (parse
job, review screen, confirm, stock update) is unreachable because upload itself never succeeds.

**Suggested fix (for the owning build agent, not applied here — QA does not modify `services/`):**
either (a) set `UPLOADS_DIR` to a path inside a writable, chown'd-to-`app` volume mount in
`docker-compose.yml` (and provision that volume), or (b) `RUN mkdir -p /repo/services/app/.data &&
chown -R app:app /repo/services/app/.data` in the Dockerfile before `USER app`, or (c) both — a
mounted volume without correct ownership will hit the same `EACCES` on first boot of a fresh
volume.

**Oracle status:** `tests/integration/nfe-import.test.ts` (4 tests) and
`tests/e2e/ui/flows/nfe-import-journey.spec.ts` (1 test) are correctly RED against this bug and
were NOT weakened to hide it — see `coverage-report.md` for the full execution ledger.

---

## Non-findings (checked, confirmed NOT bugs)

- **Webhook idempotency (PagBank, AC-008):** initially looked broken (401 on every call) — root
  cause was two test-fixture bugs (wrong header name / wrong payload shape assumed by the Wave A
  scaffold, written before the real PagBank integration existed). Fixed in `tests/`; the real
  implementation is correct (verified: idempotent replay, invalid-signature rejection, decline ->
  `past_due` transition all pass against the live app+DB). See `high.md` is NOT applicable here —
  this is a test-integrity note, not an app finding.
