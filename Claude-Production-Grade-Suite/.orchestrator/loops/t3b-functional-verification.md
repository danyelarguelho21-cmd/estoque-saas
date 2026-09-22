# Loop: T3b Frontend Engineer — Functional Verification (Phase 4b)

```yaml
loop:
  goal: garantir que a fast oracle E o build de produção real (`next build`) fiquem verdes,
        e que a navegação/composição de componentes funcione de ponta a ponta.
  producer: frontend-engineer (este agente)
  oracle: |
    Tier 1 composto — em ordem crescente de rigor:
    1. Claude-Production-Grade-Suite/.orchestrator/oracle.sh (typecheck + lint, workspaces)
    2. npm run build --workspace services/app (next build — compila E pré-renderiza as 28 rotas)
    3. npm run test --workspace services/app (vitest — suíte própria, co-localizada)
  delta: saída de erro do oracle/build da iteração anterior, não o histórico completo
  ratchet: contagem de erros de build/typecheck (nunca pode regredir vs. baseline)
  budget: budget padrão do modo Standard (plateau após 2 rounds sem progresso)
  exit: converged
```

## Iterações

- iter 1: `oracle.sh` verde (typecheck+lint) durante toda a construção das páginas — mantido
  verde após CADA edição via hook automático (ver 01-analysis.md). Nenhuma regressão neste
  nível em nenhum momento da fase de build de páginas.
- iter 2: rodei `npm run build --workspace services/app` (oracle mais forte — o typecheck/lint
  local não pega erros de runtime do App Router nem de composição de bibliotecas de terceiros).
  Build FALHOU: `Error: @prisma/client did not initialize yet` ao coletar `/api/readyz` — causa
  raiz é código do Software Engineer (`libs/shared/src/db/client.ts`, fora do escopo deste
  agente), resolvido rodando `npm run prisma:generate --workspace libs/shared` (pré-requisito de
  ambiente, não uma regressão introduzida por este agente).
  Build FALHOU novamente, agora por bug real neste agente: `Error: Slot failed to slot onto its
  children. Expected a single React element child` em `/` e `/_not-found` — o componente
  `Button` (src/components/ui/button.tsx) injetava o spinner de loading como filho irmão de
  `children` mesmo quando `asChild` estava ativo, violando o contrato de filho único do Radix
  `Slot`. Esse bug NUNCA teria sido pego por `tsc --noEmit` + `eslint` isoladamente — só o build
  real do Next.js (prerender) o expôs. Corrigido: `asChild` agora renderiza `<Slot>{children}</Slot>`
  sem o spinner condicional como sibling (ver commit/diff em button.tsx).
- iter 3: `npm run build --workspace services/app` → 28 rotas + `/_not-found` compiladas e
  pré-renderizadas com sucesso, 0 erros. Adicionei teste de regressão
  (`src/components/ui/button.test.tsx`, caso "passes exactly one child through... when asChild
  is used") para impedir reintrodução do bug.
- iter 4: aviso de depreciação do build ("middleware" → "proxy", Next.js 16) verificado via
  WebSearch (nextjs.org/docs/messages/middleware-to-proxy, set/2026) e migrado
  (`src/middleware.ts` → `src/proxy.ts`, função `middleware` → `proxy`). Build re-executado: 0
  avisos, 0 erros.
- iter 5: `npm run test --workspace services/app` — suíte de testes própria (13 casos,
  rbac/format/button) não rodava por incompatibilidade de versão entre `@vitejs/plugin-react`
  (instalado como `latest`, exige Vite 6/7) e `vite@5.4.21` (trazido pelo `vitest@^2.1.0` já
  pinado no scaffold). Corrigido fixando `@vitejs/plugin-react@^4.3.0` (compatível com Vite 5) —
  não toquei na versão de `vitest` do scaffold para não romper `libs/shared`, que compartilha o
  mesmo workspace hoisting. Suíte rodou: 3 arquivos, 13 testes, todos verdes.

## Saída

Oracle: verde · Build: verde (28 rotas + not-found, 0 erros, 0 avisos) · Testes: 13/13 verdes.

exit: converged
