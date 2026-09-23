# Vendas e Clientes

Spec: [`api/openapi/sales.yaml`](../../api/openapi/sales.yaml) · Implementação: [`services/app/src/modules/sales`](../../services/app/src/modules/sales)

Todas as rotas requerem `sessionCookie` + `sales:write`/`sales:read` (todos os papéis, incluindo
`vendedor`).

## Vendas

| Rota | Descrição |
|---|---|
| `GET /api/sales` | Relatório de faturamento — filtros `storeId`, `from`, `to`, paginado, retorna também `totalAmountCents` agregado do período filtrado |
| `POST /api/sales` | Registra venda |
| `GET /api/sales/{saleId}` | Detalhe da venda |

`POST /api/sales` — `SaleInput`: `{ storeId, customerId?, paymentMethodLabel?, items: [{ productId, batchId?, quantity, unitPriceCents }] }`.

Pontos importantes:
- **Debita estoque automaticamente**, dentro da mesma transação que grava a venda — sem passo
  manual de `POST /api/stock/exits`.
- Se `batchId` é omitido em um item de produto perecível, a sugestão FEFO
  (ver [stock.md](./stock.md#fefo-first-expired-first-out)) é aplicada automaticamente.
- `paymentMethodLabel` é **informativo apenas** — não integra um gateway de pagamento do cliente
  final da loja; é só um rótulo (dinheiro/cartão/pix) para o relatório de vendas. Não confundir
  com o gateway de cobrança da assinatura SaaS (PagBank, ver [billing.md](./billing.md)).
- `409` se houver estoque insuficiente para algum item (checado sob o mesmo
  `pg_advisory_xact_lock` do restante do domínio de estoque — sem essa transação, duas vendas
  concorrentes do mesmo produto poderiam ambas "ver" estoque suficiente e vender além do saldo real).

## Clientes

| Rota | Descrição |
|---|---|
| `GET /api/customers` | Lista clientes do tenant, `search` por nome, paginado |
| `POST /api/customers` | Cadastra cliente — `CustomerInput: { name, document?, phone?, email? }` (só `name` é obrigatório) |
| `GET /api/customers/{customerId}/history` | Histórico de compras (lista de `Sale`) |

## Próximos passos

- [stock.md](./stock.md) — FEFO e movimentações de estoque geradas por uma venda.
- [dashboard.md](./dashboard.md) — produtos mais vendidos, curva ABC (derivados de `sales`/`sale_items`).
