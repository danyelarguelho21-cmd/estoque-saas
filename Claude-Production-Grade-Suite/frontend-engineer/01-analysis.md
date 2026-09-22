# Frontend Engineer — Fase 1: Análise

## Arquitetura alvo (override)
Monolito modular Next.js 16 App Router (ADR-001). Todo código de UI vive em
`services/app/src/app/**` (rotas) e `services/app/src/components/**` (UI compartilhada),
dentro do MESMO app Next.js onde o Software Engineer (agente paralelo, worktree separado)
implementa Route Handlers em `services/app/src/app/api/**`. Sem split frontend/backend.

## Rotas derivadas do BRD (9 épicos) × OpenAPI

| Grupo | Rotas | Epic BRD | OpenAPI |
|---|---|---|---|
| Auth/onboarding | `/entrar`, `/cadastro` | Epic 1, 9 | auth.yaml, billing.yaml |
| Dashboard | `/painel` | Epic 7, 6 | dashboard.yaml, stock.yaml (alerts) |
| Catálogo | `/produtos`, `/produtos/novo`, `/produtos/[productId]`, `/produtos/importar`, `/produtos/categorias`, `/produtos/fornecedores` | Epic 2 | catalog.yaml |
| Estoque | `/estoque`, `/estoque/entrada`, `/estoque/saida`, `/estoque/transferencias`, `/estoque/nfe`, `/estoque/nfe/[importId]`, `/estoque/alertas` | Epic 3, 4, 6 | stock.yaml |
| Vendas | `/vendas`, `/vendas/nova`, `/vendas/[saleId]`, `/vendas/relatorio`, `/vendas/clientes`, `/vendas/clientes/[customerId]` | Epic 5 | sales.yaml |
| Usuários e lojas | `/configuracoes/lojas`, `/configuracoes/usuarios` | Epic 1, 8 | tenants.yaml |
| Assinatura | `/assinatura` | Epic 9 | billing.yaml |
| Admin interno | `/admin/entrar`, `/admin`, `/admin/tenants` | Epic 9 | admin.yaml |
| Raiz | `/` (redirect por sessão), `not-found` | — | — |

## Decisões de fronteira (boundary-safety)
- Login usa `signIn("credentials", ...)` de `next-auth/react` (Pattern 2 — delega ao Auth.js,
  não replica `/api/auth/login` manualmente via fetch). Logout usa `signOut()`.
- Cadastro de empresa (`/cadastro`) POSTa direto em `/api/auth/signup` via `fetch` (não é rota
  de página, é endpoint da API — Pattern 1) e, no sucesso, chama `signIn("credentials", …)`.
- `middleware.ts` usa `getToken()` de `next-auth/jwt` (edge-safe, não depende de
  `services/app/src/modules/auth` estar implementado — evita acoplamento de compilação com o
  agente backend rodando em paralelo) para proteger rotas de tenant; redireciona para `/entrar`
  com `callbackUrl` (nunca hardcoded — Pattern 4).
- Painel administrativo (`/admin/*`) usa sessão TOTALMENTE separada (`__Host-platform-session`,
  fora do Auth.js) — login via `fetch` direto em `/api/platform-admin/login`. Middleware checa
  a presença do cookie separadamente, nunca reaproveita lógica de tenant.
- Upload de NF-e/CSV usa `fetch` com `FormData` direto na API (nunca `<Link>`).
- Download de boleto/fatura usa `<a href>` cru para a URL do gateway, nunca `<Link>`.

## Decisão de estilo (Fase 5)
Modo de engajamento = Standard → o processo pede 1-2 perguntas via `AskUserQuestion`. Essa
ferramenta NÃO está disponível no toolset deste agente nesta execução (verificado via
ToolSearch — nenhum resultado). Sob a diretriz de Auto Mode ("fazer a chamada razoável e
seguir"), a escolha de estilo foi auto-resolvida: **High Tech / dashboard denso em dados**,
consistente com produto B2B de gestão de estoque (paleta neutra fria + accent azul/verde para
status, tipografia system-ui, componentes compactos para tabelas densas). Decisão documentada
aqui para transparência; não é uma alegação de aprovação do usuário.

## Dependências adicionadas (services/app/package.json)
clsx, tailwind-merge, class-variance-authority, lucide-react, @tanstack/react-query, recharts,
date-fns, @radix-ui/react-{dialog,select,tabs,dropdown-menu,label,checkbox,switch,toast,avatar,
progress,slot}, @tailwindcss/postcss (dev). Justificativa: tech-stack.md exige "Tailwind CSS +
shadcn/ui" — Radix é a base primitiva do shadcn/ui (acessibilidade correta sem reinventar
foco/teclado/ARIA). react-query substitui `useEffect` manual para data-fetching (Common
Mistakes do skill). recharts para os gráficos do painel (curva ABC, giro).
