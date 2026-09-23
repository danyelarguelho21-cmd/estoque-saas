# Referência de API — estoque-saas

Esta referência é derivada diretamente dos contratos OpenAPI 3.1 em [`api/openapi/`](../../api/openapi/)
— um arquivo por domínio, mais `_common.yaml` com os componentes compartilhados (erros, paginação,
security schemes). Em caso de divergência entre esta página e o YAML, **o YAML é a fonte de
verdade**; esta referência existe para navegação e contexto de uso, não para redefinir o contrato.

Todas as rotas vivem sob `services/app/src/app/api/` (Next.js Route Handlers). A referência cobre
**53 operações** em 8 domínios:

| Domínio | Spec | Documento | Operações |
|---|---|---|---|
| Autenticação e onboarding | [`auth.yaml`](../../api/openapi/auth.yaml) | [auth.md](./auth.md) | 4 |
| Tenant, lojas e usuários | [`tenants.yaml`](../../api/openapi/tenants.yaml) | [tenants.md](./tenants.md) | 7 |
| Catálogo (produtos, categorias, fornecedores) | [`catalog.yaml`](../../api/openapi/catalog.yaml) | [catalog.md](./catalog.md) | 11 |
| Estoque (entradas, saídas, NF-e, lotes, alertas) | [`stock.yaml`](../../api/openapi/stock.yaml) | [stock.md](./stock.md) | 10 |
| Vendas e clientes | [`sales.yaml`](../../api/openapi/sales.yaml) | [sales.md](./sales.md) | 6 |
| Cobrança (planos, assinatura, faturas, webhook) | [`billing.yaml`](../../api/openapi/billing.yaml) | [billing.md](./billing.md) | 6 |
| Dashboards e analytics | [`dashboard.yaml`](../../api/openapi/dashboard.yaml) | [dashboard.md](./dashboard.md) | 4 |
| Painel administrativo interno | [`admin.yaml`](../../api/openapi/admin.yaml) | [admin.md](./admin.md) | 5 |

## Autenticação

Existem **duas sessões completamente separadas** (zero-trust interno — ver
[`docs/architecture/design-principles.md`](../architecture/design-principles.md)):

| Cookie | Escopo | Quem usa |
|---|---|---|
| `__Host-session` | Sessão Auth.js do usuário de um tenant (admin/operador/vendedor) | Todas as rotas de domínio: auth, tenants, catalog, stock, sales, billing, dashboard |
| `__Host-platform-session` | Sessão HMAC própria do painel interno do dono do SaaS | Somente `/api/platform-admin/*` (`admin.yaml`) |

Uma sessão nunca autentica rotas do outro tipo — comprometer uma não compromete a outra. Não há
API key nem OAuth para consumidores externos hoje: a API é consumida pelo próprio frontend
Next.js (mesma origem, cookies `__Host-*` com `Secure`/`HttpOnly`/`SameSite`).

## RBAC (papéis dentro de um tenant)

Três papéis — `admin`, `operador`, `vendedor` — aplicados centralmente por
[`libs/shared/src/rbac/index.ts`](../../libs/shared/src/rbac/index.ts) e reforçados em cada Route
Handler via `requireRole()`. Resumo de permissões (ver o arquivo para a matriz completa):

| Permissão | admin | operador | vendedor |
|---|:---:|:---:|:---:|
| `catalog:write` / `stock:write` | ✓ | ✓ | — |
| `catalog:read` / `stock:read` | ✓ | ✓ | ✓ |
| `sales:write` / `sales:read` | ✓ | ✓ | ✓ |
| `users:manage` / `billing:manage` / `tenant:manage` | ✓ | — | — |
| `dashboard:read` | ✓ | ✓ | — |

Uma requisição sem a permissão exigida recebe `403 FORBIDDEN` (ver [Erros](#erros) abaixo) — nunca
um 404 disfarçado (404 é reservado para "não existe ou pertence a outro tenant", ver ADR-002).

## Paginação

Endpoints de listagem usam cursor opaco, nunca offset:

- Query params: `cursor` (opcional, de uma resposta anterior) e `limit` (1–100, default 20).
- Resposta: `{ items: [...], page: { next_cursor, has_more } }`.

## Formato de erro

Toda resposta de erro segue o schema `Error` de `_common.yaml`:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "O campo 'sku' é obrigatório.",
  "details": { "...": "..." },
  "trace_id": "b3f1c9a0-..."
}
```

`trace_id` está sempre presente — use-o ao reportar um problema ou correlacionar com logs. A
hierarquia de erros de domínio (`AppError` e subclasses) vive em
[`libs/shared/src/errors/index.ts`](../../libs/shared/src/errors/index.ts) e mapeia 1:1 para
`code`/status HTTP:

| `code` | Status | Quando |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Corpo/query inválido |
| `UNAUTHORIZED` | 401 | Sem sessão válida |
| `FORBIDDEN` | 403 | Sessão válida, sem permissão (RBAC) |
| `NOT_FOUND` | 404 | Recurso não existe **ou pertence a outro tenant** — RLS nunca vaza um 403 revelando que o recurso existe em outro tenant, sempre 404 |
| `CONFLICT` | 409 | Estado inválido para a operação (ex: downgrade de plano que excede limites, itens de NF-e não mapeados) |
| `PLAN_LIMIT_REACHED` | 409 | Limite de produtos/usuários/lojas do plano atingido |
| `PAYMENT_REQUIRED` | 402 | Cobrança recusada |
| `RATE_LIMITED` | 429 | Limite de tentativas excedido (login/signup — ver `.env.example`) |
| `INTERNAL_ERROR` | 500 | Erro inesperado — nunca vaza stack trace/mensagem interna |

## O que esta referência **não** cobre

- **Webhooks de saída** (o sistema não emite webhooks para terceiros hoje) — não existe AsyncAPI
  spec no projeto porque não há evento assíncrono exposto externamente. O único webhook do sistema
  é de **entrada** (`POST /api/webhooks/pagbank`, documentado em [billing.md](./billing.md)).
- **Rate limiting** como política geral de API — hoje é aplicado apenas em `/api/auth/login`,
  `/api/auth/signup` e `/api/platform-admin/login` (ver `services/app/src/lib/rate-limit.ts` e as
  variáveis `RATE_LIMIT_*` comentadas em `.env.example`), não em endpoints de domínio.
- **Versionamento de API** — não existe estratégia de versionamento (`/v1/`, header, etc.) hoje;
  todas as rotas são implicitamente "v1" sem prefixo. Documentado aqui como lacuna conhecida, não
  como recurso existente.

## Próximos passos

- [Guia do desenvolvedor](../guides/developer-guide.md) — como rodar a stack localmente para testar estes endpoints.
- [Visão geral de arquitetura](../architecture/overview.md) — como estes domínios se encaixam no monolito modular.
