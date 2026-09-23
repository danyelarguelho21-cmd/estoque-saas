# Compound Learnings

## Learning: 2026-09-23 — estoque-saas (HARDEN remediation → SHIP → SUSTAIN)

### What Worked

- **Fixing bugs by running the real stack, not by reading code.** Every genuine bug this session found (CR-1's race, the EACCES upload bug, the 500-vs-404 mapping, the three test-infra migration/race bugs) was confirmed by actually booting Postgres+Redis, hitting real HTTP endpoints, and watching things fail — never by static review alone. The HARDEN remediation pass explicitly re-derived confidence from a live 127-test run rather than trusting `tasks.md`'s own narrative, and this caught things a "looks fixed" read-through would have missed (e.g. the concurrent-DROP-SCHEMA race only appeared once containers were actually recreated fresh and vitest ran files in parallel).
- **pg_advisory_xact_lock for row-level contention.** Cheap (no schema change), scoped exactly to the contended tuple, and composes cleanly with Prisma's `$transaction` — the right tool whenever "read current state, then write a derived value" needs to be atomic across concurrent callers and a `SELECT ... FOR UPDATE` target isn't a clean single row.
- **Turning a check-then-act idempotency guard into `updateMany` + returned count.** Applies broadly beyond this project: any "has this already happened?" guard implemented as SELECT-then-branch-then-write has the same race window under READ COMMITTED. Make the write itself the atomic check.
- **SRE re-verifying HARDEN's own claims against source, not trusting the task-graph narrative.** T9b explicitly greped/read the actual fix code for every claimed remediation before building on top of it, and this is what caught the CR-1↔missing-`lock_timeout` compounding interaction — a real finding a more trusting pass would have missed.
- **Receipt recovery via verbatim handback.** Once the first worktree agent's receipt was lost (gitignored path, worktree deleted before merge), every subsequent agent was instructed to print its receipt JSON verbatim in the handback report — cheap insurance, no loss after that.

### What Failed

- **Docker Desktop + a nearly-full host disk = a wedged daemon, not a clean error.** Repeated image builds during earlier hardening work filled the disk; Docker didn't fail loudly, it just stopped responding to `docker ps`/`docker build`. Recovery took manual disk triage (removing merged git worktrees, clearing npm cache) before the daemon recovered on its own. **Lesson: check host disk headroom before starting a build-heavy session on a shared/personal machine, not after things start timing out.**
- **`.orchestrator/receipts/` is gitignored, and `git worktree remove` doesn't care.** A worktree-isolated agent's receipt is invisible to `git merge` (it's untracked+ignored) and gets deleted along with the worktree directory the moment `git worktree remove` runs. First T7 receipt was lost this way and had to be reconstructed from the agent's prose report + on-disk artifact verification. Fixed for later agents by asking them to echo the JSON verbatim in their handback.
- **`resetTestDatabase()` only applied 1 of 9 migrations for a long time**, silently making every HTTP-driven integration test unverifiable against a truly fresh container — nobody had actually run the full suite against a from-scratch container until this session, because earlier runs always inherited a partially-migrated container from a prior (broken) attempt. The bug hid behind its own symptom.
- **Test env var omissions produce misleading failures that look like app bugs.** Forgetting `APP_DATABASE_URL` in a manual vitest invocation made `withTenant()` silently fall back to the superuser connection, which made RLS isolation tests "fail" in a way that looked exactly like a real RLS leak (44 rows instead of 1) until the missing env var was spotted. Always suspect the harness before the app when a security-shaped test fails unexpectedly.

### Architecture Insights

- The single-VPS / Docker Compose / no-cloud-provider decision (ADR-001/ADR-003) held up well under the SHIP pass — DevOps didn't need to fight the architecture to produce a real production deployment surface (Caddy overlay, CD workflow, backup scripts), and SRE's capacity analysis confirmed the connection-pool bottleneck is a config problem, not an architecture problem, at this project's actual target scale.
- The shared-worker-process-across-all-tenants model (ADR-001) is the thing most likely to need revisiting first if the tenant count grows — SRE flagged `generate_monthly_charge`/`scan_expiry_alerts`'s per-tenant sequential loop as the concurrency-1 ceiling worth a dedicated redesign pass before it becomes a real incident, not now.

### Time Sinks

- Disk-space recovery (Docker daemon wedged) cost real wall-clock time mid-session and wasn't part of any planned phase — it's infrastructure risk that doesn't show up in a task graph.
- Re-discovering the correct local env-var recipe (matching ports, `UPLOADS_DIR`, `connection_limit`, rate-limit overrides) to boot app+worker against the test stack took several iterations before `local-dev-stack-bootstrap` (T12) captured it as a skill — this exact rediscovery cost is precisely what that skill exists to prevent next time.

### Skip Next Time

- Don't re-run the full integration suite from a container that might still carry state from a previous (possibly broken) attempt — always recreate the test containers (`down -v && up -d`) before treating a "green" run as trustworthy evidence of a from-scratch fix.

### Add Next Time

- Before removing any worktree, check for `.orchestrator/receipts/*.json` inside it and copy the file out first (or just always ask the agent to echo it verbatim, as adopted mid-session here) — cheaper than reconstruction after the fact.
- A disk-space check as a standing pre-flight for any session expected to do repeated Docker builds, on hosts that aren't dedicated CI runners.
