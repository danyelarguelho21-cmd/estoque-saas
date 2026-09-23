# estoque-saas

SaaS multi-tenant de gestão de estoque por assinatura recorrente, para pequenas e médias empresas
brasileiras (varejo, distribuidoras, farmácias, mercados).

## Documentação

- **Requisitos (BRD):** [`Claude-Production-Grade-Suite/product-manager/BRD/brd.md`](./Claude-Production-Grade-Suite/product-manager/BRD/brd.md)
- **Visão geral de arquitetura:** [`docs/architecture/overview.md`](./docs/architecture/overview.md) — ADRs, diagramas e tech stack completos em [`docs/architecture/`](./docs/architecture/)
- **Referência de API:** [`docs/api/`](./docs/api/) — contratos completos (OpenAPI 3.1) em [`api/openapi/`](./api/openapi/)
- **Guia do desenvolvedor:** [`docs/guides/developer-guide.md`](./docs/guides/developer-guide.md) · **Contribuindo:** [`docs/guides/contributing.md`](./docs/guides/contributing.md)
- **Guia operacional (deploy, backup, segredos, SLOs, runbooks):** [`docs/operations/`](./docs/operations/)
- **Modelo de dados (ERD + migrações):** [`schemas/`](./schemas/)

## Stack

TypeScript · Next.js 16 (App Router) · PostgreSQL 18 (Row-Level Security multi-tenant) · Prisma ·
Redis/BullMQ (jobs assíncronos) · Auth.js · PagBank/PagSeguro (cobrança). Ver
[ADR-003](./docs/architecture/architecture-decision-records/ADR-003-tech-stack.md) para a
justificativa completa.

## Rodando localmente

Pré-requisitos: Node.js 24+, Docker e Docker Compose.

```bash
cp .env.example .env
# edite .env com valores locais (a senha padrão do Postgres já funciona para dev)

npm install
make up          # sobe postgres, redis, app e worker via Docker Compose
make generate     # gera o Prisma Client
make migrate      # aplica o schema inicial (schemas/migrations/0001_init.sql via Prisma Migrate)
```

A aplicação fica disponível em `http://localhost:3000`. Health check em `/api/healthz`,
readiness (checa conexão com o banco) em `/api/readyz`.

Para desenvolvimento sem Docker (apenas app, usando Postgres/Redis já rodando):

```bash
make dev      # Next.js dev server
make worker   # worker de background jobs, em outro terminal
```

## Estrutura do projeto

```
libs/shared/        # Prisma schema, cliente com contexto RLS, PaymentProvider, auditoria
services/app/        # Next.js (UI + API) e worker — monolito modular (ADR-001)
  src/app/            # Rotas (App Router) e Route Handlers
  src/modules/         # Domínios isolados: auth, catalog, stock, sales, billing, admin
  src/worker/          # Entrypoint do processo de background jobs
docs/architecture/   # ADRs, diagramas C4/sequência, tech stack, princípios de design
api/openapi/          # Contratos de API por domínio
schemas/               # ERD, migração SQL de referência, fluxo de dados
```

Cada módulo em `src/modules/*` só é importado pelo seu próprio `index.ts` — nunca por arquivos
internos de outro módulo (fronteira reforçada por lint, ver ADR-001). Isso mantém o monolito
extraível em serviços independentes no futuro, se a escala justificar.

## Status

Produção-pronto: passou pelas fases DEFINE, BUILD, HARDEN e SHIP do pipeline production-grade
(Gate 3 aprovado) — regras de negócio, UI, testes (unit/integration/e2e/performance), auditoria de
segurança, revisão de código, deploy em VPS via Docker Compose (Caddy + TLS automático, CD via
GitHub Actions) e prontidão SRE (SLOs, chaos engineering, runbooks) implementados. Ver
[`Claude-Production-Grade-Suite/.orchestrator/tasks.md`](./Claude-Production-Grade-Suite/.orchestrator/tasks.md)
para o histórico completo do pipeline.
