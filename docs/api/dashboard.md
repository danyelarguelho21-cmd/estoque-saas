# Dashboards e Analytics

Spec: [`api/openapi/dashboard.yaml`](../../api/openapi/dashboard.yaml) · Implementação: [`services/app/src/modules`](../../services/app/src/modules)
(consultas de leitura sobre `sales`/`sale_items`/`stock_movements`; não é um módulo próprio —
cada Route Handler consulta os módulos de domínio relevantes).

Todas as rotas requerem `sessionCookie` + `dashboard:read` (`admin`/`operador` — **não**
`vendedor`, ver [tabela RBAC](./README.md#rbac-papéis-dentro-de-um-tenant)).

| Rota | Descrição |
|---|---|
| `GET /api/dashboard/abc-curve` | Curva ABC de produtos por `revenue` ou `quantity`, filtrável por `storeId`/`from`/`to`. Retorna cada produto com `value`, `cumulativePercentage` e `class` (`A`/`B`/`C`). |
| `GET /api/dashboard/turnover` | Giro de estoque agrupado por `product` ou `category` |
| `GET /api/dashboard/stalled-products` | Produtos sem movimento em `days` dias (default 30) |
| `GET /api/dashboard/best-sellers` | Produtos mais vendidos por período, paginado (`LimitParam`) |

Estes endpoints são explicitamente **tolerantes a staleness/indisponibilidade breve** por decisão
de produto (BRD) — nenhuma regra de dinheiro ou correção de estoque depende deles estarem no ar a
cada segundo. Isso se reflete no SLO mais baixo (`web-dashboard-availability-slo`, 99.0% vs. 99.5%
das rotas críticas) em `Claude-Production-Grade-Suite/sre/slo/sli-definitions.yaml`.

## Próximos passos

- [sales.md](./sales.md) e [stock.md](./stock.md) — dados-fonte destes relatórios.
