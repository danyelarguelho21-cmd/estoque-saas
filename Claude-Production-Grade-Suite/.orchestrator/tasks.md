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
| T4b | DevOps — build/push containers | T3a, T4a | superseded (validado manualmente via Docker real nesta sessão) |
| T5b | QA Engineer — implement tests | T3a, T3b, T5a | completed (agent a8e60567ffdc5b706, main tree — Docker real stack: 50/55 vitest + 7/8 e2e passando, 2 bugs reais achados e reportados, 0 fraqueza de oracle) |
| T6c | Security Engineer — code audit + dep scan | T3a, T3b, T6a | completed (agent ad8fa8a2fa5905714, worktree — pending merge) |
| T6d | Code Reviewer — actual review | T3a, T3b, T6b | completed (agent a467395d59307a6d9, worktree — pending merge) |
| T7 | DevOps — IaC + CI/CD | T5b, T6c, T6d | completed (agent ad04af8786372e3a3, worktree — merged e212533) |
| T8 | Remediation — HARDEN fixes | T5b, T6c, T6d | completed (main tree, this session — see receipt below) |
| T9b | SRE — chaos + capacity | T7, T8, T9a | completed (agent af5d8ebb14e9ffedf, worktree — merged 8881b7a) |
| T10 | Data Scientist (conditional — não aplicável, sem LLM/ML) | T7, T8 | skipped |
| T11 | Technical Writer — docs | T9b | pending |
| T12 | Skill Maker — skills customizadas | T9b | pending |
| T13 | Compound Learning + Assembly | T11, T12 | pending |

Gates: G1 (após T1) ✓ aprovado, G2 (após T2) ✓ aprovado, G3 (após T9b, antes de T11/T12) — pronto para apresentação.

## SHIP — T7 (DevOps) + T9b (SRE) concluídos

- **T7** (agent ad04af8786372e3a3, worktree, merge b5e0c05): overlay `docker-compose.prod.yml` com
  Caddy (reverse proxy + TLS automático via Let's Encrypt), scripts de backup/restore do Postgres,
  script de rotação de segredos, workflow `.github/workflows/cd-production.yml` (build+push GHCR +
  deploy via SSH + smoke test em `/api/healthz`/`/api/readyz`), orientação de log shipping (Vector,
  documentado não habilitado por padrão). Sem cloud provider/Kubernetes/Terraform — mantido dentro
  da decisão já tomada (VPS único via Docker Compose, ADR-003/c4-container.md). Validado localmente
  (`docker compose config`, lint de YAML/shell); certificado TLS real e deploy SSH real não
  verificados (precisam de VPS real).
- **T9b** (agent af5d8ebb14e9ffedf, worktree, merge 8881b7a): revisão de prontidão de produção
  re-verificada contra o código atual (não confiou na alegação do tasks.md — conferiu
  `pg_advisory_xact_lock`, `DEFAULT_JOB_OPTIONS`, `AbortSignal.timeout`, `updateMany` atômico e o
  chown do Dockerfile diretamente no código-fonte). 3 novos achados High de prontidão: sem
  tratamento de SIGTERM/graceful shutdown, sem dimensionamento de connection pool do Postgres,
  zero limites de recursos nos containers. 6 cenários de chaos engineering + playbook de game day
  (crash do worker, exaustão de conexões do Postgres, Redis indisponível, flood/duplicação de
  webhook do PagBank, disco cheio no VPS — o mesmo tipo de incidente real que ocorreu nesta sessão
  — e contenção do lock de estoque em SKU quente). Análise de capacidade aponta o connection pool
  do Postgres como gargalo #1 na escala 1x; achado mais acionável: o advisory lock do CR-1 sem
  `lock_timeout` configurado pode encadear em exaustão de conexões sob contenção. 4 novos runbooks
  fechando lacunas que `alerting-thresholds.md` já sinalizava como faltantes.

**Achados High de prontidão — fechados antes do Gate 3 (commit 732d589), a pedido do usuário:**
handler de SIGTERM/SIGINT no `worker/index.ts` (drena os 4 Workers do BullMQ antes de sair,
`stop_grace_period` do serviço `worker` elevado a 60s); `connection_limit`/`pool_timeout` nas 3
connection strings + nova migration `0010_role_timeouts.sql` (`statement_timeout`/`lock_timeout`/
`idle_in_transaction_session_timeout` por role, valores confirmados via `SHOW` contra o banco
real); `mem_limit`/`cpus` nos 5 serviços Docker. Todos os valores vieram de
`sre/capacity/scaling-configs.yaml` (SRE é autoridade única). Reverificado: 127 testes verdes
(75 unit + 52 integration) contra stack real recriada do zero, typecheck/lint limpos.

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

## HARDEN Wave B — T5b (QA Engineer) concluído

Suíte `tests/` (oracle de Wave A) executada de verdade contra a stack Docker real
(`docker compose up -d` — Postgres 18/Redis 7/app/worker saudáveis). Resultado: unit 7/7,
integration 43/48, e2e (Playwright/Chromium real) 7/8 — total 57/63 (90.5%). As 6 falhas restantes
são 2 bugs reais e genuínos da aplicação (não do teste), reproduzidos independentemente via
curl/Node-fetch/`docker compose logs` antes de qualquer alteração em `tests/`:

- **C-1 (Critical)** — upload de NF-e 100% quebrado em produção real: `EACCES` ao escrever em
  `./.data/uploads` (usuário non-root do container Docker sem permissão, nenhum volume gravável
  provisionado). Quebra o AC-001 do BRD (critério de aceite mais citado) de ponta a ponta.
- **H-1 (High)** — recurso inexistente retorna 500 em vez de 404 (Prisma `P2025` de
  `findUniqueOrThrow`/`findFirstOrThrow` não capturado por `handleRoute()`), sistêmico em ≥6 call
  sites (stores, users, tenant, transfers, billing×2). Viola o contrato documentado de NotFound.

## HARDEN Wave B — T8 (Remediation) concluído

Todos os findings Critical/High de T5b (QA), T6c (Security) e T6d (Code Review) corrigidos e
verificados de ponta a ponta contra stack real (Postgres 18 + Redis 7 em containers, app+worker
locais apontando para eles) — 126 testes verdes (75 unit + 52 integration), typecheck/lint limpos
em todo o monorepo. Commit `fb3e338`.

- **CR-1 (Critical, code review)** — lost-update race + TOCTOU de oversell no saldo de estoque.
  `pg_advisory_xact_lock` por (tenant, produto, loja) em toda operação que lê/escreve o saldo
  derivado; transferências travam origem+destino em ordem determinística (evita deadlock). Novo
  teste de concorrência real (`tests/integration/stock-concurrency.test.ts`).
- **C-1 (Critical, QA)** — EACCES no upload de NF-e em Docker. `Dockerfile` faz chown do diretório
  de upload antes de `USER app`; `docker-compose.yml` monta volume nomeado compartilhado entre
  `app`/`worker` com `UPLOADS_DIR` absoluto.
- **H-1 (High, QA)** — Prisma P2025 agora mapeado centralmente para 404 em `handleRoute()`.
- **HI-1..HI-4 (High, code review)** — N+1 queries (5 call sites) batched; BullMQ com
  retry/backoff; PagBank com timeout de 10s; idempotência do webhook PagBank trocada de
  check-then-act para UPDATE atômico (`updateMany` + count), com teste de concorrência real.

Bugs de infraestrutura de teste encontrados e corrigidos no caminho (nenhum teste HTTP-driven era
verificável antes disto contra um container realmente limpo): `docker-compose.test.yml` com layout
de dados pré-Postgres-18 (crash loop); `resetTestDatabase()` só aplicava 1 de 9 migrations (roles
`app_user`/`platform_admin_role` nunca existiam); race de `DROP SCHEMA` concorrente entre arquivos
de teste paralelos (corrigido com advisory lock + double-checked locking); fixture de `daysUntil`
flaky por usar UTC em vez de data local.

Findings completos com repro + fix sugerido em `Claude-Production-Grade-Suite/qa-engineer/findings/
{critical,high,medium,low}.md`. Dois gaps P1 do risk register fechados com suítes novas reais
(`tests/integration/transfers.test.ts` — 6/6, incl. teste dedicado de atomicidade multi-item;
`tests/integration/plan-downgrade.test.ts` — 5/5). Revisão de integridade de teste (TDD pair
close-out): nenhuma fraqueza encontrada em `tests/` desde o merge-back da Wave A (único commit que
tocou `tests/` antes desta sessão fez uma mudança puramente aditiva). 8 bugs genuínos de teste (não
da app) corrigidos em `tests/` nesta sessão — ver `qa-engineer/test-plan.md` §"Wave B" para o ledger
completo (destaque: `http-test-client.ts` tinha um bug de cookie-jar que causava ~20 falsos 401 em
quase toda a suíte de integração). Receipt: `.orchestrator/receipts/T5b-qa-engineer.json`.
