# Frontend Engineer — Resumo da construção (Fases 2-6)

## Rotas entregues (28 páginas + not-found)

| Grupo | Rotas |
|---|---|
| Raiz | `/` (redirect por sessão), `not-found` |
| Auth/onboarding | `/entrar`, `/cadastro` |
| Dashboard | `/painel` |
| Catálogo | `/produtos`, `/produtos/novo`, `/produtos/[productId]`, `/produtos/importar`, `/produtos/categorias`, `/produtos/fornecedores` |
| Estoque | `/estoque`, `/estoque/entrada`, `/estoque/saida`, `/estoque/transferencias`, `/estoque/nfe`, `/estoque/nfe/[importId]`, `/estoque/alertas` |
| Vendas | `/vendas`, `/vendas/nova`, `/vendas/[saleId]`, `/vendas/clientes`, `/vendas/clientes/[customerId]` |
| Config | `/configuracoes/lojas`, `/configuracoes/usuarios` |
| Cobrança | `/assinatura` |
| Admin interno | `/admin/entrar`, `/admin`, `/admin/tenants` |

Nota: `/vendas` já cobre "relatório por período/loja" (filtros de data + loja + total do
período) — não criei uma rota `/vendas/relatorio` separada para evitar uma página quase
duplicada; documentado aqui em vez de silenciosamente omitido.

## Componentes

- `components/ui/*` (20 primitivos): button, input, textarea, label, field, card, badge,
  spinner, empty-state, alert, select, checkbox, switch, tabs, dialog, dropdown-menu, avatar,
  table, pagination, toast.
- `components/layout/*`: app-shell, sidebar, header, auth-shell, admin-shell, config-tabs,
  nav-items.
- `components/features/*`: role-gate, plan-limit-banner, stat-card, file-drop, product-form,
  product-picker, store-filter, fefo-suggestion-panel, nfe-quick-create-dialog, plan-card,
  abc-curve-chart, turnover-chart.
- `lib/api/*`: cliente fetch fino (`client.ts`) + um módulo por domínio OpenAPI (auth, tenants,
  catalog, stock, sales, dashboard, billing, admin) — tipos em `lib/api/types.ts` espelhando os
  schemas de `api/openapi/*.yaml` manualmente (sem geração automática — ver Gaps).
- `lib/rbac.ts`, `lib/format.ts`, `lib/stock-labels.ts`, `lib/payments/pagbank.ts`, `lib/utils.ts`.
- `hooks/use-current-user.ts`, `hooks/use-plan-limits.ts`.

## Decisões arquiteturais chave

1. **Auth.js v5 sem acoplamento ao módulo backend ainda não implementado**: `src/proxy.ts`
   (guarda de rotas de tenant) usa `getToken` de `next-auth/jwt` diretamente — não importa
   `services/app/src/modules/auth` (que segue `export {}` — implementação do Software Engineer
   em paralelo). Login usa `signIn("credentials", …)` de `next-auth/react` (Pattern 2). Isso
   significa que a UI está pronta para integrar assim que o backend expuser
   `app/api/auth/[...nextauth]/route.ts` + `AUTH_SECRET` — nenhuma mudança de código deste lado
   deve ser necessária, só configuração de ambiente.
2. **`middleware.ts` → `proxy.ts`**: Next.js 16.3.x deprecia a convenção `middleware` em favor de
   `proxy` (verificado via WebSearch, set/2026, nextjs.org/docs/messages/middleware-to-proxy) —
   migrado, sem mudança de comportamento.
3. **Painel administrativo (`/admin/*`) com sessão 100% separada**: cookie
   `__Host-platform-session`, nunca Auth.js. Login via `fetch` direto (Pattern 1).

## Gaps de contrato encontrados (documentados, não inventados silenciosamente)

- `api/openapi/admin.yaml` não define endpoint de logout do painel administrativo — assumido
  `POST /api/platform-admin/logout` por convenção simétrica a `/api/auth/logout`
  (`lib/api/admin.ts`, comentário inline). **Ação para o Software Engineer**: implementar esse
  endpoint ou confirmar outro contrato.
- `api/openapi/catalog.yaml` não expõe uma contagem total de produtos (só paginação por
  cursor/`has_more`) — o aviso de "limite do plano" (`PlanLimitBanner`) só é mostrado com
  confiança em `/configuracoes/usuarios` e `/configuracoes/lojas` (onde busco até 100 itens e
  uso `!has_more` como proxy de contagem real). Em `/produtos` o limite real só é reforçado no
  submit (erro 409 `PlanLimitReached` tratado explicitamente no formulário) — não há banner
  proativo ali por falta de endpoint de contagem.
- `api/openapi/stock.yaml` não tem endpoint de listagem de imports de NF-e (só criar + buscar
  por id) — `/estoque/nfe` é só a tela de upload; não há histórico de imports passados na UI.
- `api/openapi/stock.yaml` `StockExitInput`/`SaleInput` aceitam só um `batchId` por item (não uma
  lista) — quando a sugestão FEFO cobre a quantidade com múltiplos lotes, a UI permite escolher
  manualmente APENAS entre os lotes retornados na sugestão (não há endpoint de listagem completa
  de lotes por produto/loja para uma busca livre).
- Tokenização de cartão PagBank.js (`lib/payments/pagbank.ts`) não pode ser verificada/integrada
  de ponta a ponta sem credenciais de produção do gateway — a função lança
  `PagBankNotLoadedError` com mensagem clara na UI em vez de simular sucesso; o fluxo Pix/boleto
  (sem esse gap) funciona ponta a ponta.

## Verificação real executada (não apenas alegada)

- `Claude-Production-Grade-Suite/.orchestrator/oracle.sh` — verde após cada edição (hook
  automático bloqueou e eu corrigi toda vez que ficou vermelho).
- `npm run build --workspace services/app` — verde, 28 rotas + not-found compiladas e
  pré-renderizadas, 0 avisos, 0 erros (encontrou e permitiu corrigir um bug real de composição
  Radix Slot que o typecheck/lint sozinhos NÃO detectam — ver loop
  `t3b-functional-verification.md`).
- `npm run test --workspace services/app` — 13/13 testes verdes (rbac, format, button incl.
  regressão do bug do Slot).
- Navegação: todo `href`/`<Link>` do código-fonte foi extraído via grep e verificado contra as
  rotas existentes — nenhum link morto encontrado.

## Não verificado (honestidade sobre limites deste ambiente)

- Não há navegador real disponível nesta sessão — não cliquei fisicamente em cada elemento.
  A verificação funcional foi feita por (a) rastreamento de código fonte de cada handler/link,
  (b) o build real do Next.js compilando E pré-renderizando todas as rotas (prova que cada
  página renderiza sem erro no server, incluindo Client Components montados), e (c) testes
  automatizados executados de fato.
- Integração real com Auth.js (login efetivo) depende do módulo `auth` do Software Engineer
  ainda não implementado — não pôde ser testada ponta a ponta nesta sessão (esperado em
  desenvolvimento por ondas paralelas).
- Storybook não foi criado (fora do que o brief do orquestrador pediu explicitamente; priorizei
  cobertura completa das 28 rotas do BRD dentro do orçamento da tarefa).
