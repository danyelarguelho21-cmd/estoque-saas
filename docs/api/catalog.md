# Catálogo (produtos, categorias, fornecedores)

Spec: [`api/openapi/catalog.yaml`](../../api/openapi/catalog.yaml) · Implementação: [`services/app/src/modules/catalog`](../../services/app/src/modules/catalog)

Todas as rotas requerem `sessionCookie`. Permissão `catalog:write` (admin/operador) para
criar/editar/remover; `catalog:read` (admin/operador/vendedor) para listar/ler.

## Produtos

| Rota | Descrição |
|---|---|
| `GET /api/products` | Lista produtos — `search` (nome/SKU/código de barras), `belowMinStock` (filtra alerta), paginado |
| `POST /api/products` | Cria produto — `409 PLAN_LIMIT_REACHED` se excede `maxProducts` do plano |
| `POST /api/products/import` | Importação em lote via CSV (multipart) — enfileira job assíncrono, retorna `202 { importJobId }` |
| `GET /api/products/{productId}` | Detalhe — inclui `currentStock` (saldo agregado, ou por `storeId` se filtrado) |
| `PATCH /api/products/{productId}` | Atualiza produto |
| `DELETE /api/products/{productId}` | Remove produto — **soft delete** (`deleted_at`), não remove linhas de `stock_movements`/`sale_items` associadas |
| `PUT /api/products/{productId}/store-settings/{storeId}` | Define `minStockOverride` — estoque mínimo específico daquela loja, sobrepõe `minStockGlobal` do produto para efeito de alertas nessa loja |

`ProductInput` (campos obrigatórios: `sku`, `name`, `unitOfMeasure`): `categoryId`, `barcode`,
`supplierId`, `isPerishable` (default `false` — liga o fluxo de lote/validade para este produto
específico, ver [stock.md](./stock.md)), `minStockGlobal`, `costPriceCents`, `salePriceCents`.

## Categorias e fornecedores

| Rota | Descrição |
|---|---|
| `GET /api/categories` / `POST /api/categories` | Lista/cria categoria (`{ name }`) |
| `GET /api/suppliers` / `POST /api/suppliers` | Lista (paginado)/cria fornecedor (`SupplierInput: { name, cnpj, contact }`) |

## Próximos passos

- [stock.md](./stock.md) — entradas de estoque (manuais e via NF-e), que referenciam `productId`.
- [dashboard.md](./dashboard.md) — curva ABC e giro de estoque por produto.
