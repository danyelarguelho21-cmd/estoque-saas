# Loop: t3a-boot-smoke-debug

```yaml
loop:
  goal:     validar o sistema fim-a-fim contra Postgres/Docker reais (Docker estava disponível
            neste ambiente, ao contrário do que a tarefa assumia) e corrigir tudo que só se
            manifesta em runtime real (nunca pego por typecheck/lint/testes unitários)
  producer: software-engineer (este agente)
  oracle:   requisições HTTP reais (curl) contra a app rodando com `next start` + Postgres 18 real
            via docker compose — Tier 1, executável, resultado observável e determinístico
  delta:    o próximo erro/comportamento incorreto observado na resposta HTTP ou no log do
            servidor (adicionei log de erro server-side em handleRoute() no meio do loop,
            achado 5, exatamente porque o loop precisava dessa visibilidade para continuar)
  ratchet:  nº de bugs de runtime confirmados e não corrigidos (baseline: sistema nunca tinha
            rodado contra Postgres real antes desta sessão)
  budget:   ilimitado dentro da sessão (JIT loop, sem cap fixo pré-definido — parado por
            convergência: fluxo completo re-executado do zero, sem nenhuma falha remanescente)
  exit:     converged
```

- iter 1: `docker compose up postgres` — crash loop (postgres:18-alpine mudou layout de volume,
  precisa `/var/lib/postgresql` não `/var/lib/postgresql/data`) → corrigido docker-compose.yml
- iter 2: `prisma migrate dev` — falha "Environment variable not found: DATABASE_URL" (Prisma CLI
  não olha `.env` da raiz do monorepo) → corrigido libs/shared/package.json com dotenv-cli
- iter 3: `prisma migrate dev` aplicado com sucesso (21 tabelas criadas)
- iter 4: `apply-role-grants.mjs` — função SECURITY DEFINER falha na criação ("Final statement
  returns text instead of uuid") → descoberto que todo id/FK do Prisma virava `text`, não `uuid`
  (faltava `@db.Uuid`) → corrigido em schema.prisma (todos os 21 models) + nova migração
  `uuid_columns` aplicada
- iter 5: `apply-role-grants.mjs` — "cannot insert multiple commands into a prepared statement"
  em 0006 → bug no próprio splitter do script (não tratava comentário `--` inline no fim de linha
  de GRANT) → corrigido scripts/apply-role-grants.mjs
- iter 6: `apply-role-grants.mjs` roda limpo (26 statements) → `bootstrap-platform-admin.mjs`
  criado (não existia caminho nenhum para popular o primeiro platform_admin) → roda OK
- iter 7: `next build`/`next start` sem env vars (Next.js só carrega `.env` de dentro de
  services/app/, nunca da raiz) → corrigido com `.env` local em services/app/ + worker script com
  dotenv-cli
- iter 8: app sobe, `/api/healthz`/`/api/readyz`/`/api/auth/signup`/`GET /api/tenant` OK
- iter 9: `POST /api/products` retorna 500 sem NENHUM log → corrigido handleRoute() para logar
  erros desconhecidos com trace_id
- iter 10: erro real revelado: `AuditLog.userId` recebe string vazia (não uuid válido) →
  `session.user.id` nunca era populado pelo callback `session` customizado do NextAuth (sobrescreve
  o comportamento default sem reimplementá-lo) → corrigido auth.config.ts + rbac.ts agora falha
  fechado em vez de degradar para ""
- iter 11: `POST /api/products` OK, `POST /api/stores` OK, `POST /api/stock/entries` OK
  (balanceAfter correto), `POST /api/sales` OK (debita estoque corretamente), venda excedendo
  estoque retorna 409 CONFLICT correto, `/api/alerts/low-stock` dispara corretamente
- iter 12: **achado crítico** — criado um segundo tenant (signup) e ele conseguia LISTAR e LER POR
  ID o produto do primeiro tenant via `/api/products` — RLS nunca estava habilitada no banco real
  (a migração gerada por `prisma migrate dev` não inclui `ENABLE ROW LEVEL SECURITY`/`CREATE
  POLICY`, que só existiam nos arquivos de referência 0001/0002, nunca aplicados) → criado
  `schemas/migrations/0008_enable_row_level_security.sql`, aplicado via apply-role-grants.mjs
- iter 13 (verificação final): tenant B agora recebe lista vazia e 404 ao tentar acessar o produto
  do tenant A; tenant A continua vendo seus próprios dados normalmente; login/métricas/listagem do
  platform admin (role BYPASSRLS separada) funcionando corretamente
- exit: converged — fluxo completo (2 tenants, produtos, lojas, estoque, vendas, alertas,
  isolamento RLS, admin) reexecutado do zero sem nenhuma falha remanescente
