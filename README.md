# estoque-saas

SaaS multi-tenant de gestão de estoque por assinatura recorrente, para pequenas e médias empresas
brasileiras (varejo, distribuidoras, farmácias, mercados).

## Documentação

- **Requisitos (BRD):** [`Claude-Production-Grade-Suite/product-manager/BRD/brd.md`](./Claude-Production-Grade-Suite/product-manager/BRD/brd.md)
- **Arquitetura (ADRs, diagramas, tech stack):** [`docs/architecture/`](./docs/architecture/)
- **Contratos de API (OpenAPI 3.1):** [`api/openapi/`](./api/openapi/)
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

Scaffold gerado pelo Solution Architect (fase DEFINE do pipeline production-grade). Implementação
de regras de negócio, UI e testes é responsabilidade da fase BUILD.
