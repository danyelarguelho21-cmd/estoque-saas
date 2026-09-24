# Guia do desenvolvedor — estoque-saas

Como rodar o projeto localmente, como o código é organizado e como escrever código novo que
respeita as regras já estabelecidas (fronteiras de módulo, isolamento de tenant). Para o "porquê"
de cada decisão, os documentos de arquitetura ([visão geral](../architecture/overview.md), ADRs)
são a fonte de verdade — este guia foca no "como".

## Quickstart (menos de 10 minutos)

Pré-requisitos: **Node.js 24+**, **Docker** e **Docker Compose**.

```bash
git clone <repo> && cd estoque-saas
cp .env.example .env        # valores default já funcionam para dev local

npm install
make up                      # sobe postgres, redis, app e worker (docker compose up -d --build)
make generate                 # gera o Prisma Client
make migrate                  # aplica migrations + grants de role + seed dos planos
```

A aplicação fica em `http://localhost:3000`. `GET /api/healthz` (liveness) e `GET /api/readyz`
(checa conexão com o banco) confirmam que a stack subiu corretamente.

```bash
make bootstrap-admin   # cria o primeiro platform_admin (painel interno), lê PLATFORM_ADMIN_BOOTSTRAP_* do .env
```

### Desenvolvimento sem Docker

Com Postgres/Redis já rodando (localmente ou via `docker compose up -d postgres redis`):

```bash
make dev      # Next.js dev server (usa APP_DATABASE_URL do .env)
make worker   # em outro terminal — processo de background jobs (BullMQ)
```

### Autenticação em desenvolvimento

Não há seed de usuário de tenant pronto — crie um via `POST /api/auth/signup` (ver
[docs/api/auth.md](../api/auth.md)) ou pela UI de onboarding. Para o painel administrativo interno
(`/api/platform-admin/*`), use `make bootstrap-admin` e depois `POST /api/platform-admin/login`.

## Estrutura do projeto

```
libs/shared/            # Prisma schema, cliente com contexto RLS (withTenant), RBAC,
                         #   PaymentProvider, plan-limits, storage, erros, auditoria — pacote
                         #   compartilhado entre services/app (web+worker)
services/app/
  src/app/               # Next.js App Router — páginas + Route Handlers (src/app/api/**/route.ts)
  src/modules/           # Domínios isolados: auth, catalog, stock, sales, billing, admin
  src/worker/            # Entrypoint do processo de background jobs (mesmo código, CMD diferente)
docs/architecture/       # ADRs, diagramas C4/sequência, tech stack, princípios de design
api/openapi/             # Contratos de API por domínio (OpenAPI 3.1)
schemas/                 # ERD, migrações SQL de referência, fluxo de dados
tests/                   # unit, integration, e2e, performance — oracle de aceite da QA (ver abaixo)
scripts/                 # bootstrap-platform-admin, seed-plans, apply-role-grants, backup/restore,
                          #   rotate-secrets, deploy — ver docs/operations/README.md
```

Cada arquivo de módulo (`services/app/src/modules/{auth,catalog,stock,sales,billing,admin}`)
exporta sua API pública por um único `index.ts`. Exemplo real
([`modules/stock/index.ts`](../../services/app/src/modules/stock/index.ts)):

```ts
// Módulo: stock — entradas, saídas, transferências, NF-e, lotes/FEFO, alertas.
// Fronteira: outros módulos e Route Handlers importam SOMENTE deste index.ts (ADR-001).
export { suggestFefoBatches, ... } from "./fefo";
export { getCurrentStock, getCurrentStockForProducts, lockStockRow } from "./balance";
export { createManualEntry, ... } from "./entries";
// ...
```

Isso é o padrão **monolito modular** da [ADR-001](../architecture/architecture-decision-records/ADR-001-architecture-pattern.md):
um único deployable (Next.js + worker, mesmo código), domínio isolado por diretório, comunicação
entre módulos só via `index.ts`. Se a escala algum dia justificar extrair um módulo para serviço
próprio, `billing` e o parser de NF-e de `stock` são os candidatos priorizados (já rodam via fila
BullMQ, o que facilita a extração — ver o plano de extração no fim da ADR-001).

> **Nota de precisão:** a ADR descreve a fronteira como "reforçada por lint". Hoje
> ([`services/app/eslint.config.js`](../../services/app/eslint.config.js)) o projeto usa apenas
> `eslint-config-next` (core-web-vitals + typescript) — **não há regra `no-restricted-imports` ou
> `eslint-plugin-boundaries` configurada** para falhar o build em um import direto de dentro de
> outro módulo. A fronteira é hoje enforced **por convenção de código e revisão**, não
> mecanicamente. Trate-a como um contrato rígido de qualquer forma (ver
> [Contributing](./contributing.md)) — e se você for adicionar essa regra de lint, isso fecha uma
> lacuna real, não uma tarefa cosmética.

## RLS e multi-tenancy — como escrever uma query nova

Toda tabela tenant-scoped tem RLS habilitada (ADR-002): a política do Postgres só libera linhas
onde `tenant_id = current_setting('app.tenant_id', true)::uuid`. O cliente Prisma runtime
(`services/app` e `worker`) conecta com a role `app_user`, que **não** tem `BYPASSRLS` — então a
única forma de uma query enxergar dados é setando esse contexto de tenant primeiro.

Isso é feito por `withTenant()` ([`libs/shared/src/db/client.ts`](../../libs/shared/src/db/client.ts)):
abre uma transação, executa `SELECT set_config('app.tenant_id', $1, true)` (escopo de transação),
roda seu callback, comita. **Toda** escrita ou leitura tenant-scoped passa por aqui — não existe
outro caminho legítimo.

Exemplo real, um módulo de domínio completo
([`modules/catalog/categories.ts`](../../services/app/src/modules/catalog/categories.ts)):

```ts
import { withTenant } from "@estoque-saas/shared";

export async function listCategories(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.category.findMany({ orderBy: { name: "asc" } }));
}

export async function createCategory(tenantId: string, name: string) {
  return withTenant(tenantId, (tx) => tx.category.create({ data: { tenantId, name } }));
}
```

E o lado do Route Handler, que resolve a sessão antes de chamar o módulo
([`app/api/stock/fefo-suggestion/route.ts`](../../services/app/src/app/api/stock/fefo-suggestion/route.ts)):

```ts
export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("stock:read");   // sessão + RBAC (401/403)
    const input = parseQuery(new URL(req.url).searchParams, QuerySchema);
    const batches = await withTenant(ctx.tenantId, (tx) => tx.batch.findMany({ ... }));
    return ok(suggestFefoBatches(...));
  });
}
```

**Regra para código novo:** toda tabela tenant-scoped nova precisa, no mesmo PR: (a) coluna
`tenant_id uuid not null`, (b) `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + política, (c) toda
query passando por `withTenant()`, nunca `platformPrisma`/`basePrisma` direto. O teste
`tests/integration/rls-schema-sweep.test.ts` varre o schema e falha se alguma tabela com
`tenant_id` não tiver RLS habilitada — é o oracle automatizado desta regra, não confie só em
revisão manual.

**As duas exceções deliberadas:** `plans` e `platform_admins` são globais (sem `tenant_id`, sem
RLS) — leia via `platformPrisma`. O módulo `admin` (painel interno) usa um terceiro cliente,
`platformAdminPrisma` (role `platform_admin_role`, `BYPASSRLS` explícito) — **nunca** importado por
módulos tenant-scoped. Se você está escrevendo código fora de `modules/admin` e sente necessidade
de `platformAdminPrisma`, pare — isso é um sinal de design errado, não uma necessidade legítima.

## Rodando os testes

```bash
npm run test              # todos os workspaces (libs/shared + services/app) — unit-level, sem Docker
npm run test:qa:unit      # tests/unit (Vitest) — funções puras, sem I/O
npm run test:qa:integration:up    # sobe postgres-test (porta 5433) + redis-test (porta 6380) —
                                    #   containers ISOLADOS do stack de dev (tests/integration/docker-compose.test.yml)
npm run test:qa:integration       # roda tests/integration contra esses containers
npm run test:qa:integration:down  # derruba e remove os volumes de teste
npm run test:qa:e2e       # Playwright — jornadas completas via browser real
npm run test:qa           # tudo sob tests/ (unit + integration) em um único comando Vitest
```

`tests/integration/docker-compose.test.yml` mantém porta/banco de dados **separados** do
`docker-compose.yml` de desenvolvimento (5433/`estoque_saas_test` vs. 5432/`estoque_saas`) — a
suíte de QA nunca toca dados de dev. Cada arquivo de teste de integração chama
`resetTestDatabase()` no próprio `beforeAll` (não há um `globalSetup` único — decisão deliberada
para que `vitest run tests/integration/rbac.test.ts` sozinho continue funcionando, ver comentário em
[`tests/integration/setup.ts`](../../tests/integration/setup.ts)).

`npm run typecheck` e `npm run lint` (ambos `--workspaces --if-present`) mais os quatro comandos
de teste acima são exatamente o que `.github/workflows/test.yml` roda em todo PR — rode-os
localmente antes de abrir um PR (ver [Contributing](./contributing.md#antes-de-abrir-um-pr)).

`tests/` é o **oracle de aceite de QA** — nunca enfraqueça um teste ali para fazer seu código
passar (ver [Contributing](./contributing.md#disciplina-de-teste)).

## Migrações de banco

`schemas/migrations/*.sql` (0001–0010) são o histórico de referência **legível**, mas quem
efetivamente aplica schema é o Prisma Migrate a partir de
[`libs/shared/prisma/schema.prisma`](../../libs/shared/prisma/schema.prisma) — `make migrate`
roda `prisma migrate dev` (local) e aplica grants/seed. Em produção,
[`scripts/deploy.sh`](../../scripts/deploy.sh) usa `prisma migrate deploy` (não-interativo). Ver
[ERD](../../schemas/erd.md) para o modelo de dados completo e
[ADR-002](../architecture/architecture-decision-records/ADR-002-multi-tenancy-strategy.md) para o
racional de RLS.

## Próximos passos

- [Contributing](./contributing.md) — como abrir um PR, disciplina de teste, checklist antes de commitar.
- [Visão geral de arquitetura](../architecture/overview.md) — ADRs e diagramas C4/sequência.
- [Referência de API](../api/README.md) — todos os endpoints, por domínio.
- [Guia operacional](../operations/README.md) — deploy, backup, segredos, runbooks.
