# Tenants, Lojas e Usuários

Spec: [`api/openapi/tenants.yaml`](../../api/openapi/tenants.yaml) · Implementação: [`services/app/src/modules/auth`](../../services/app/src/modules/auth)
(tenant/lojas/usuários vivem no módulo `auth` — ver `stores.ts`, `tenant.ts`, `users.ts`, exportados
por `auth/index.ts`).

Todas as rotas requerem `sessionCookie`.

## Tenant

| Rota | RBAC | Descrição |
|---|---|---|
| `GET /api/tenant` | qualquer papel | Dados da empresa do usuário autenticado |
| `PATCH /api/tenant` | `admin` (`tenant:manage`) | Atualiza `consolidatedStock` / `perishableTrackingEnabled` |

`consolidatedStock` e `perishableTrackingEnabled` são flags de configuração por tenant que mudam o
comportamento de outros domínios: `consolidatedStock=true` faz `StoreIdParam` (usado em
stock/sales/dashboard) ser opcional/agregado; `perishableTrackingEnabled` habilita o fluxo de
lote/validade/FEFO (ver [ADR-006](../architecture/architecture-decision-records/ADR-006-fefo-batch-tracking.md)).

## Lojas

| Rota | RBAC | Descrição |
|---|---|---|
| `GET /api/stores` | qualquer papel | Lista lojas/depósitos do tenant (paginado) |
| `POST /api/stores` | `admin`/`operador` | Cria loja/depósito — `409 PLAN_LIMIT_REACHED` se excede `maxStores` do plano |
| `PATCH /api/stores/{storeId}` | `admin`/`operador` | Atualiza loja — `404` se não existe ou é de outro tenant |

`StoreInput`: `{ name, type: "loja"|"deposito", address }`.

## Usuários

| Rota | RBAC | Descrição |
|---|---|---|
| `GET /api/users` | `admin` (`users:manage`) | Lista usuários do tenant |
| `PATCH /api/users/{userId}/role` | `admin` (`users:manage`) | Altera papel (`admin`/`operador`/`vendedor`) de um usuário |

Criação de usuário é feita via `POST /api/users/invite` — ver [auth.md](./auth.md).

## Próximos passos

- [auth.md](./auth.md) — convite de usuários.
- [catalog.md](./catalog.md) e [stock.md](./stock.md) — recursos que referenciam `storeId`.
