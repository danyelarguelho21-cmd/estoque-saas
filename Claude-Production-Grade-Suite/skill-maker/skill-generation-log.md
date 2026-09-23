# Skill Maker — T12 (SUSTAIN) — Generation Log

Engagement mode: Standard (per `.orchestrator/settings.md`). Express-equivalent posture used for
this task: candidate skills were fully specified by the T12 task brief with concrete file
evidence requested up front, so no subjective/irreversible choice existed to surface via
AskUserQuestion (the mode-1/2-questions allowance is for framework/visual/strategy choices; this
task has none of those — it's "which of 4-5 evidence-backed candidates earn their place").

## Candidates considered vs. evidence found

| # | Candidate (from task brief) | Verdict | Evidence |
|---|---|---|---|
| 1 | Stock-mutating operation scaffold | **Created** — `stock-operation-scaffold` | `services/app/src/modules/stock/{entries,exits,transfers}.ts` all follow identical `withTenant → lockStockRow → business logic → recordAudit` shape; `balance.ts` header comment documents CR-1 (the lost-update/TOCTOU race this exact pattern fixes); `transfers.ts` `transferOneItem` shows the deterministic dual-lock ordering needed for two-store operations; `tests/integration/stock-concurrency.test.ts` is the regression test for CR-1. |
| 2 | New API route scaffold | **Created** — `api-route-scaffold` | 46 `route.ts` files all call `handleRoute()`; `services/app/src/lib/http.ts` shows `parseJsonBody`/`parseQuery`/`handleRoute` and the P2025→404 mapping added for QA finding H-1; `catalog/products.ts` `listProducts` and `catalog/suppliers.ts` show the identical cursor-pagination idiom (`cursor:{id}, skip:1`, `take: limit+1`, `has_more`/`next_cursor`); code-reviewer finding HI-1 (`code-reviewer/findings/high.md`) shows the N+1 bug this convention prevents when skipped. |
| 3 | Test-harness health check | **Created** — `test-harness-health-check` | `tests/fixtures/db-test-helpers.ts` header comment + `tasks.md` HARDEN Wave B section document three real, independently-discovered bugs this session: `resetTestDatabase()` applying only 1/9 migrations, Postgres 18 tmpfs path convention change (`.../data` → `/var/lib/postgresql`), and the `pg_advisory_lock`+double-checked-locking fix for concurrent `DROP SCHEMA` races between parallel Vitest files. |
| 4 | Local dev stack bootstrap | **Created** — `local-dev-stack-bootstrap` | `tests/integration/docker-compose.test.yml` (ports 5433/6380, tmpfs path comment), `.env.example` (`connection_limit`/`pool_timeout` SRE finding, `UPLOADS_DIR` C-1 EACCES finding, rate-limit override block for integration-test IP-loop scenario), `Makefile` (`migrate` chains prisma migrate + `apply-role-grants.mjs` + seed — skipping the latter reproduces the `app_user` auth-failure bug documented in `db-test-helpers.ts`), `package.json` scripts (`test:qa:integration:up/down`). |
| 5 | Cursor-pagination as standalone skill | **Folded into #2** | Genuinely the same convention living in the same files (`route.ts` GET handlers + list-query modules) as the rest of the API route pattern — a separate skill would duplicate context rather than add it. |
| — | N+1 query / http-test-client cookie-jar bug | **Not a standalone skill** | Real findings (code-reviewer HI-1, QA Wave B cookie-jar bug in `http-test-client.ts`) but each is a one-off already fixed and guarded by a specific test/comment at its own file, not a distinct RECURRING workflow a future session would re-derive — referenced as supporting evidence inside skills #2 and #3 instead. |

Verdict: 4 skills, not 5 — the brief explicitly allows fewer when the 5th would be manufactured,
and skill #5 (cursor pagination) has no separable evidence base from #2's route-handler pattern.

## Grounding discipline

Every code sample inside each SKILL.md is copied/adapted from a real file read during this task
(paths cited inline in each skill), not invented. Portuguese domain comments in the codebase
(`entries.ts`, `balance.ts`, `transfers.ts`) were read and paraphrased in the skills' English
prose but the skills themselves are written in English to match this plugin's own skill
conventions — the underlying source files being scaffolded remain the ground truth for exact
Portuguese comment style if an implementer copies from them directly.

## Verification performed

- Confirmed `.claude/skills/` did not previously exist (fresh install, no collision risk).
- Re-read each written SKILL.md's frontmatter after writing: `name` is kebab-case
  (letters/digits/hyphens only) in all four; `description` starts with "Use when"/"Use before"
  and contains triggering conditions only (file paths, symptoms, error strings), not a summary of
  the skill's internal steps.
- Checked each `description` field length via `sed -n '3p' SKILL.md | wc -c` (includes the
  `description: ` prefix + trailing newline): stock-operation-scaffold 415 (402 net),
  api-route-scaffold 319 (306 net), test-harness-health-check 494 (480 net),
  local-dev-stack-bootstrap trimmed from 535/521-net (over the 500-char limit) to 391/377-net.
  All four now comply with the &lt;500-char description rule.
- Cross-checked each skill's code samples against the actual source file open in this session
  (entries.ts, balance.ts, transfers.ts, http.ts, products/route.ts, products.ts,
  db-test-helpers.ts, docker-compose.test.yml, .env.example, Makefile, package.json) rather than
  from memory/training data.
- Confirmed no overlap with plugin-level `production-grade:*` skills — these four are entirely
  project-specific (real file paths, real bug IDs like CR-1/HI-1/H-1/C-1 from this project's own
  HARDEN findings), not a repackaging of the orchestrator's phase dispatch or generic protocols.
