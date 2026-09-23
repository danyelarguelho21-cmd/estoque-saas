# Painel Administrativo Interno (dono do SaaS)

Spec: [`api/openapi/admin.yaml`](../../api/openapi/admin.yaml) · Implementação: [`services/app/src/modules/admin`](../../services/app/src/modules/admin)

Rotas sob `/api/platform-admin/*` — **completamente isoladas** da sessão de tenants (cookie
`__Host-platform-session`, zero-trust interno, ver
[design-principles.md](../architecture/design-principles.md)). É a única superfície de API que
usa `platformAdminPrisma` — role Postgres `platform_admin_role` com `BYPASSRLS` deliberado (ver
[`libs/shared/src/db/client.ts`](../../libs/shared/src/db/client.ts) e
[ADR-002](../architecture/architecture-decision-records/ADR-002-multi-tenancy-strategy.md)): RLS
existe para proteger tenants entre si, não para esconder dados do dono da plataforma, mas o
privilégio é mínimo — a role só tem GRANT nas tabelas que o painel precisa (`tenants`,
`subscriptions`, `invoices`, `platform_admins`), nunca DML amplo em tabela tenant-scoped.

## Login

`POST /api/platform-admin/login` — fora do `security` padrão (`security: []`), já que ainda não
há sessão. `{ email, password }` -> `200` (sessão de plataforma criada) ou `401`.

## Tenants (assinantes)

| Rota | Descrição |
|---|---|
| `GET /api/platform-admin/tenants` | Lista todos os assinantes com status de assinatura, filtro `subscriptionStatus`, paginado |
| `POST /api/platform-admin/tenants/{tenantId}/suspend` | Suspende manualmente um tenant (ex: inadimplência crítica, abuso) |
| `POST /api/platform-admin/tenants/{tenantId}/reactivate` | Reativa um tenant suspenso |

## Métricas

`GET /api/platform-admin/metrics` -> `{ mrrCents, activeTenantsCount, pastDueTenantsCount, churnRateLast30d, newTenantsLast30d }`
— métricas agregadas da plataforma inteira (todos os tenants).

## Próximos passos

- [billing.md](./billing.md) — ciclo de vida de assinatura/fatura por trás destas métricas agregadas.
- [Guia do desenvolvedor](../guides/developer-guide.md#bootstrap-do-admin-da-plataforma) — como criar o primeiro `platform_admin` localmente (`make bootstrap-admin`).
