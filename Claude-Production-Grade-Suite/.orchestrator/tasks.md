# Task Graph — estoque-saas

| Task | Description | Blocked By | Status |
|------|-------------|-----------|--------|
| T1 | Product Manager — BRD | — | completed |
| T2 | Solution Architect — Architecture | T1 | completed |
| T3a | Software Engineer — Backend services | T2 | completed (agent a466a6ff2c4a78586, worktree) |
| T3b | Frontend Engineer — Pages/UI | T2 | completed (agent a0e4e0011ea876eb6, worktree) |
| T4a | DevOps — Dockerfiles + CI skeleton | T2 | completed (agent a13ff3a55b94c8979, worktree) |
| T5a | QA Engineer — Test plan | T2 | completed (agent a27c4e0571b9d898a, worktree) |
| T6a | Security Engineer — STRIDE threat model | T2 | completed (agent af6031d26f480ce62, worktree) |
| T6b | Code Reviewer — conformance checklist | T2 | completed (agent a1d3822051a6eaeb0, worktree) |
| T9a | SRE — SLO definitions | T2 | completed (agent a5eea49c3cff33d37, worktree) |
| T4b | DevOps — build/push containers | T3a, T4a | pending |
| T5b | QA Engineer — implement tests | T3a, T3b, T5a | pending |
| T6c | Security Engineer — code audit + dep scan | T3a, T3b, T6a | pending |
| T6d | Code Reviewer — actual review | T3a, T3b, T6b | pending |
| T7 | DevOps — IaC + CI/CD | T5b, T6c, T6d | pending |
| T8 | Remediation — HARDEN fixes | T5b, T6c, T6d | pending |
| T9b | SRE — chaos + capacity | T7, T8, T9a | pending |
| T10 | Data Scientist (conditional — não aplicável, sem LLM/ML) | T7, T8 | skipped |
| T11 | Technical Writer — docs | T9b | pending |
| T12 | Skill Maker — skills customizadas | T9b | pending |
| T13 | Compound Learning + Assembly | T11, T12 | pending |

Gates: G1 (após T1) ✓ aprovado, G2 (após T2) ✓ aprovado, G3 (após T9b, antes de T11/T12) — pendente.

## BUILD Wave A — merge-back concluído
Todos os 7 worktrees commitados e mesclados em `master` (commits d0c18dc..95f8d0c). Defeitos de
integração entre agentes encontrados e corrigidos no merge-back (ver commit 95f8d0c):
tenantName ausente na sessão (2 declarações de tipo conflitantes), scripts dev/build/start não
carregando .env da raiz do monorepo, bug de fuso horário em `daysUntil()`, divergência de
comportamento em `suggestFefoBatches()` entre o teste do backend e o oracle do QA (reconciliado a
favor do QA). Verificado: `npm run build` verde (46 rotas de API + 28 páginas), 59 testes de
unidade verdes, suíte de testes do QA (`tests/unit`) genuinamente verde, `tests/` typecheck limpo.
Não verificado (falta Docker neste ambiente): boot real contra Postgres/Redis, testes de
integração/e2e do QA, `docker build`/`docker compose up`.
