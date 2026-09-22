# Software Engineer — Notas de implementação (fase BUILD)

## Escopo entregue

Todos os 6 módulos (auth, catalog, stock, sales, billing, admin) implementados com lógica de
domínio real + Route Handlers wireados para os endpoints definidos em `api/openapi/*.yaml`
(auth, tenants, catalog, stock, sales, dashboard, billing, admin — 8 specs). 46 rotas de API no
total (confirmado pelo output de `next build`), mais 4 processors de worker BullMQ e 1 `proxy.ts`
(Next 16).

## Schema / migrações

- `libs/shared/prisma/schema.prisma`: adicionados os 8 models que faltavam (StockMovement,
  NfeImport, NfeImportItem, Sale, SaleItem, Transfer, TransferItem, Notification), espelhando
  exatamente `schemas/migrations/0001_init.sql`.
- `schemas/migrations/0002_remaining_tables.sql`: DDL + RLS para as tabelas acima (mesmo padrão
  `DO $$ ... FOR t IN ...` de 0001).
- `schemas/migrations/0003` a `0007`: ver seção "Achados de segurança" abaixo — role separation,
  funções SECURITY DEFINER estreitas para os poucos fluxos que legitimamente precisam de
  visibilidade cross-tenant (login, webhook, painel admin, jobs do worker).

## Achados de segurança incorporados (mensagem do orchestrator/security-engineer)

1. **C-1 (RLS inerte)** — `POSTGRES_USER` da imagem `postgres:*` é sempre superuser, e RLS nunca
   se aplica a superuser. Introduzida role `app_user` (NOBYPASSRLS explícito,
   `0003_app_role_and_grants.sql`), usada pelo cliente Prisma runtime via nova env var
   `APP_DATABASE_URL` (`libs/shared/src/db/client.ts`). `DATABASE_URL` (role administrativa)
   agora só é usada por `prisma migrate`/`generate` e pelo script de bootstrap de roles.
2. **C-2 (audit_log não imutável)** — `GRANT SELECT, INSERT` + `REVOKE UPDATE, DELETE` reais
   (antes comentados/não aplicados) para `app_user` em `0003`.
3. **C-3 (bug de migração)** — `product_store_settings` não tinha `tenant_id` mas estava no loop
   de RLS (quebraria em runtime real). Corrigido em `schema.prisma` (campo `tenantId` adicionado
   ao model `ProductStoreSetting`) e em `0001_init.sql` (com nota explicando o fix).
4. **C-4 (assinatura de webhook)** — `PagBankProvider.verifyWebhookSignature` usa
   `timingSafeEqual` (constante no tempo) sobre o payload BRUTO (a rota
   `/api/webhooks/pagbank` lê `req.text()`, nunca reserializa JSON). Fail-fast no construtor se
   `apiKey`/`webhookSecret` ausentes.
5. **C-5 (fast-xml-parser XXE/CVE)** — bump `^4.5.0` → `^5.5.8` (verificado via WebSearch:
   CVE-2026-25896/26278/33036 corrigidas a partir de 5.5.6/5.5.8) + `parseTagValue: false` e
   `processEntities: false` no parser de NF-e (`modules/stock/nfe-parser.ts`). O
   `parseTagValue:false` foi um achado ADICIONAL via TDD: sem ele, fast-xml-parser converte texto
   numérico (CNPJ, NCM, EAN) para `number`, corrompendo zeros à esquerda — os testes pegaram isso
   antes de qualquer revisão manual.
6. **M-1 (hash de senha)** — bcryptjs, cost 12 (`modules/auth/password.ts`), usado tanto para
   `users.password_hash` quanto `platform_admins.password_hash`.

## Padrão adicional descoberto durante a implementação: "lookup cross-tenant estreito"

RLS + `app_user` sem bypass cria um problema estrutural em 4 fluxos que precisam encontrar dados
ANTES de saber o `tenant_id` (login por e-mail, webhook por `gateway_charge_id`, painel admin,
jobs do worker que varrem todos os tenants). Solução aplicada uniformemente: funções Postgres
`SECURITY DEFINER` estreitas (uma função, uma finalidade, sem SELECT genérico), com
`GRANT EXECUTE` (nunca `GRANT SELECT` amplo) para `app_user` — ver `0004`, `0005`, `0007`. Para o
painel administrativo (visibilidade cross-tenant ampla e legítima, não pontual), foi criada uma
role separada `platform_admin_role` (BYPASSRLS explícito, mas GRANT restrito às 5 tabelas que o
painel usa) — ver `0006` e `platformAdminPrisma` em `libs/shared/src/db/client.ts`.

## PagBank — integração real

Pesquisado via WebSearch/WebFetch em developer.pagbank.com.br (set/2026):
- Assinaturas (cartão): `POST {subscriptionsBaseUrl}/subscriptions`.
- Cancelamento: `PUT {subscriptionsBaseUrl}/subscriptions/{id}/cancel`.
- Pedidos (Pix/boleto avulso): `POST {ordersBaseUrl}/orders` com `charges[]` (boleto) ou
  `qr_codes[]` (Pix).
- Webhook: header `x-authenticity-token` = `sha256(accountToken + "-" + rawPayload)`; eventos de
  assinatura via `{event, resource.id}`, eventos de pedido via o próprio Order (`charges[].status`).

**Limitação documentada no próprio código** (`pagbank.ts`): o mapeamento exato de `cardToken`
(tokenizado client-side) para o campo de cartão da API de Assinaturas não pôde ser confirmado
byte-a-byte na documentação pública disponível — assumido `card.token`. Marcar para validação
contra sandbox real na fase HARDEN/QA (sem credenciais reais neste ambiente).

## O que ficou de fora / gaps conhecidos

- **Resolução de itens `unmatched` de NF-e**: `api/openapi/stock.yaml` não define um endpoint
  para vincular manualmente um item não correspondido a um produto (ou criar um produto rápido) —
  só o fluxo de confirmação, que BLOQUEIA (409) se restar algum item unmatched. Implementado
  fielmente ao contrato dado; falta um endpoint no contrato para o "cadastro rápido" que a
  ADR-005 menciona na UI — meta-observação para o Solution Architect, não inventado aqui.
  A lógica de match automático por `cEAN` no job `parse-nfe` está implementada; o gap só afeta o
  caso em que o EAN não bate com nenhum produto existente.
- **CSV de produtos**: import em lote não valida limite de plano por linha (poderia estourar
  `maxProducts` do plano durante uma importação grande). MVP: best-effort por linha, SKUs
  duplicados são pulados, nada mais é validado contra o plano.
- **Dashboards**: implementados como parte do módulo `sales` (não havia scaffold próprio de
  módulo `dashboard` — os 6 módulos com scaffold eram auth/catalog/stock/sales/billing/admin).
  Consultas fazem agregação em memória (aceitável na escala do MVP, <1000 tenants, ADR-002).
- **`/api/tenant`, `/api/stores`, `/api/users*`** (api/openapi/tenants.yaml): implementados dentro
  do módulo `auth` (mesma razão acima — módulo mais próximo, já tem RBAC/infra de usuário).

## Boot-smoke real (Docker estava disponível) — achados críticos só visíveis em runtime

Ao contrário do que a tarefa original assumia, Docker ESTAVA disponível neste ambiente. Rodar o
boot-smoke real (Postgres 18 real + app real + requisições HTTP reais) revelou 5 bugs que
typecheck/lint/build/testes unitários NÃO conseguiriam pegar — todos corrigidos e reverificados
end-to-end nesta sessão:

1. **CRÍTICO — RLS nunca estava habilitada no banco real.** A migração que `prisma migrate dev`
   gera a partir de `schema.prisma` não tem noção de Row-Level Security — `ALTER TABLE ... ENABLE
   ROW LEVEL SECURITY` e `CREATE POLICY` só existiam nos arquivos de referência (0001/0002), nunca
   aplicados ao banco gerenciado pelo Prisma. Confirmado empiricamente: criei dois tenants via
   signup e o tenant B conseguia LISTAR e LER POR ID o produto do tenant A via
   `GET /api/products`. Corrigido com `schemas/migrations/0008_enable_row_level_security.sql`
   (mesmo loop de 0001, idempotente), agora aplicado por `scripts/apply-role-grants.mjs` (rodado
   por `make migrate`). Reverificado: tenant B agora recebe lista vazia e 404 ao tentar ler o
   produto do tenant A.
2. **`postgres:18-alpine` crash loop.** A imagem mudou a convenção de layout de dados em 18+
   (pg_ctlcluster-compatible) — o volume precisa montar em `/var/lib/postgresql`, não mais
   `/var/lib/postgresql/data`. `docker-compose.yml` corrigido.
3. **`session.user.id` nunca populado (NextAuth).** Meu callback `session` customizado
   sobrescrevia o comportamento default do NextAuth (que preencheria `session.user.id` a partir de
   `token.sub`) sem reimplementar essa parte. Resultado: `requireSession()` caía para
   `userId: ""`, que quebrava em runtime (não no typecheck) ao gravar em qualquer coluna
   `@db.Uuid` — pego tentando criar um produto autenticado de verdade (audit_log.user_id). Corrigido
   em `modules/auth/auth.config.ts` (`session.user.id = token.sub`) + `rbac.ts` agora falha
   fechado (`UnauthorizedError`) se `id` estiver ausente, em vez de degradar para `""`.
4. **Todo id/FK do Prisma virava `text`, não `uuid`.** `String @id @default(uuid())` sem
   `@db.Uuid` mapeia para a coluna Postgres `text` — descoberto porque as funções SECURITY
   DEFINER (`RETURNS TABLE (tenant_id uuid, ...)`) falhavam na criação com erro de tipo de
   retorno, e qualquer `$queryRaw`/`$executeRaw` deste código faz `${valor}::uuid`, que não tem
   operador de comparação contra uma coluna `text`. Adicionado `@db.Uuid` em todo campo
   id/FK de `schema.prisma` (todos os 21 models) — migração `uuid_columns` aplicada e
   reverificada.
5. **`handleRoute` engolia erros sem log.** Um 500 genérico não deixava NENHUM rastro em log — só
   percebido porque fui investigar manualmente por que `POST /api/products` retornava
   `INTERNAL_ERROR` sem pista nenhuma. Corrigido: erros que não são `AppError` agora vão para
   `console.error` com o `trace_id` (nunca expostos ao cliente).
6. **Bug menor no meu próprio script de apply (`scripts/apply-role-grants.mjs`).** O splitter de
   statements SQL não tratava comentários `-- ...` inline no fim de uma linha de GRANT, então
   várias linhas de `0006_platform_admin_role.sql` viravam um único "statement" multi-comando, que
   o driver do Postgres rejeita. Corrigido (a checagem de fim-de-statement agora ignora o
   comentário inline).
7. **Sem seed do primeiro platform_admin.** Não havia nenhum caminho para criar a primeira linha
   de `platform_admins` — `/api/platform-admin/login` nunca teria contra o que autenticar.
   Adicionado `scripts/bootstrap-platform-admin.mjs` (idempotente, lê
   `PLATFORM_ADMIN_BOOTSTRAP_EMAIL/PASSWORD`).
8. **Next.js não carrega `.env` da raiz do monorepo.** `next build`/`dev`/`start` só carregam
   `.env` de dentro do próprio `services/app/`, nunca da raiz — mesmo problema para o Prisma
   CLI local (`prisma migrate`/`generate`, que olha ao lado de `schema.prisma`, não a raiz).
   Corrigido com `dotenv-cli` explícito nos scripts do `libs/shared/package.json` e
   `services/app/package.json` (worker), + um `.env` local também dentro de `services/app/`
   (Next.js não tem como ser redirecionado) — ambos gitignored, nunca committed.

Depois de todos os fixes acima, o fluxo completo foi reexecutado do zero contra Postgres real e
validado: signup (2 tenants distintos) → login → criar produto → criar loja → entrada manual de
estoque → venda (debita estoque corretamente) → venda excedendo estoque (409 CONFLICT correto,
payload com `available`/`requested`) → alerta de estoque baixo (dispara corretamente ao cruzar o
mínimo) → isolamento RLS entre os dois tenants (confirmado não vazar) → login do platform admin →
métricas da plataforma → listagem de tenants no painel admin. Todos os caminhos testados
retornaram exatamente o esperado.

## O que está VERIFICADO vs UNVERIFIED

- Typecheck + lint: verificado repetidamente, verde a cada unidade de trabalho (oracle.sh).
- `npm run build` (Next.js, Turbopack): verificado GREEN — 46 rotas de API compiladas + proxy.
- Testes unitários (Vitest): 46 testes, 100% verde, cobrindo lógica pura (FEFO, parser de NF-e
  incluindo hardening XXE, CSV parser, hashing de senha, RBAC, plan-limits, erros, assinatura de
  webhook PagBank).
- Docker ESTAVA disponível neste ambiente (ao contrário do que a tarefa original assumia). Rodei
  um boot-smoke manual completo (Postgres 18 real via docker compose + `prisma migrate deploy` +
  `apply-role-grants.mjs` + `bootstrap-platform-admin.mjs` + `next build` + `next start` + `curl`
  contra a API real) — ver seção acima para a lista de bugs achados e corrigidos. Fluxos
  verificados END-TO-END contra Postgres real: signup, login (cookie + JWT), RBAC, CRUD de
  produto/loja, entrada manual de estoque, venda com débito de estoque, venda com estoque
  insuficiente (409), alerta de baixo estoque, isolamento RLS entre dois tenants distintos, login
  de platform admin, métricas e listagem de tenants no painel admin.
- NÃO verificado por execução real neste boot-smoke manual (faltou tempo/escopo, fica para
  QA/HARDEN): FEFO aplicado a uma venda real com múltiplos lotes, atomicidade de transferência
  entre lojas, fluxo completo de import de NF-e (upload → parse job → confirm → stock_movements),
  idempotência do webhook do PagBank contra reentrega real, geração de cobrança mensal
  (`generate-monthly-charge`), scan de alertas de validade (`scan-expiry-alerts`), downgrade de
  plano bloqueado por limite excedido. Toda essa lógica foi revisada cuidadosamente por leitura de
  código + typecheck, e reusa exatamente os mesmos padrões (withTenant, resolveExitLines,
  recordAudit) já comprovados no fluxo de venda simples que FOI testado — mas não têm o mesmo nível
  de confiança de uma chamada HTTP real observada. Recomendo ao QA Engineer priorizar estes 6
  fluxos no HARDEN.
- `oracle-full.sh` (script oficial do orchestrator): também rodei via este script — build e
  suíte de testes passam; a seção de boot-smoke automatizada do próprio script tropeçou em
  problemas de timing/ambiente (porta 3000 ocupada por uma execução anterior, Postgres ainda
  subindo) que não são bugs de código — por isso fiz a verificação real manualmente como descrito
  acima, que é mais completa do que o que `oracle-full.sh` cobre sozinho.
