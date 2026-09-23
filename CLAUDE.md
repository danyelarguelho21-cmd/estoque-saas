# Production Grade Native

This project was built with the production-grade plugin. The `Claude-Production-Grade-Suite/` directory contains architecture decisions, security findings, test plans, and receipts from the build pipeline.

**At the start of every session, ask the user how they'd like to work.** Use AskUserQuestion:
- Header: "Production-Grade Native Project"
- Question: "This project was built with the production-grade pipeline. How would you like to work today?"
- Options:
  1. "Use production-grade (Recommended)" — "Route changes through specialized agents — architecture, security, and test baselines stay intact. Best for features, refactors, and anything that touches system behavior."
  2. "Work directly without the plugin" — "Make changes freely. Good for quick fixes, experiments, or when you know exactly what you're changing. You can always invoke /production-grade later if needed."
  3. "Chat about this" — "Let's discuss what I'm planning and figure out the best approach together."

If the user chooses production-grade, invoke `/production-grade` — it auto-routes to the right mode:
- Adding features → Feature mode
- Refactoring / architecture → Architect mode
- Code review → Review mode
- Adding tests → Test mode
- Security hardening → Harden mode
- Deployment changes → Ship mode
- Brainstorming → Explore mode
- Performance → Optimize mode

If the user chooses to work directly, respect that choice fully — no further reminders this session. They can always invoke `/production-grade` manually if they change their mind.

**Why this exists:** This project has architecture decisions (ADRs), API contracts, security baselines, and test coverage established by the pipeline. The production-grade plugin ensures changes go through the right specialized agents — but it's always the user's call. The plugin won't run the full pipeline for a feature request; it adapts to the scope of work.

---

## Project quick reference

- **Product:** estoque-saas — SaaS de gestão de estoque por assinatura para PMEs no Brasil (subscription inventory-management SaaS for Brazilian small/medium retail).
- **Stack:** TypeScript strict · Node 24 · Next.js 16 (App Router, modular monolith, ADR-001) · React 19 · PostgreSQL 18 with Row-Level Security (ADR-002) · Prisma 6 · Zod · BullMQ + Redis 7 · Auth.js v5 · PagBank (payments, ADR-004) · Docker Compose (single VPS target, ADR-003 — no cloud provider/Kubernetes).
- **Start here:**
  - `docs/guides/developer-guide.md` — environment setup, project structure, RLS/`withTenant()` pattern, test invocation.
  - `docs/guides/contributing.md` — module-boundary rule, RLS checklist, PR checklist.
  - `docs/api/README.md` — API reference (53 endpoints across 8 domains).
  - `docs/architecture/overview.md` — ADR summaries, C4 diagrams.
  - `docs/operations/README.md` — deployment, backup/restore, secrets, SLOs, runbooks index.
- **Pipeline history:** `Claude-Production-Grade-Suite/.orchestrator/tasks.md` is the authoritative narrative of every phase (DEFINE → BUILD → HARDEN → SHIP → SUSTAIN) and what each pass found/fixed.
- **Project-specific skills** (installed by T12, `.claude/skills/`): `stock-operation-scaffold`, `api-route-scaffold`, `test-harness-health-check`, `local-dev-stack-bootstrap` — each grounded in a real pattern or bug class this project's HARDEN passes actually found.
