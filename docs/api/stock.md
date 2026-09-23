# Estoque (entradas, saídas, transferências, NF-e, lotes)

Spec: [`api/openapi/stock.yaml`](../../api/openapi/stock.yaml) · Implementação: [`services/app/src/modules/stock`](../../services/app/src/modules/stock)

Todas as rotas requerem `sessionCookie` + `stock:write` (admin/operador) para escrita,
`stock:read` (todos os papéis) para leitura. Vendas (que também debitam estoque) usam
`/api/sales`, não este domínio — ver [sales.md](./sales.md).

## Movimentações (histórico auditável)

`GET /api/stock/movements` — paginado, filtros `storeId`, `productId`, `type` (`entrada_manual`,
`entrada_nfe`, `saida_venda`, `saida_perda`, `transferencia_saida`, `transferencia_entrada`,
`ajuste`). Cada `StockMovement` grava `balanceAfter` — o saldo já é derivado somando os
`quantity` com sinal, mas cada linha guarda o resultado para leitura rápida sem recomputar a soma
inteira a cada consulta (ver [ERD](../../schemas/erd.md#notas-de-modelagem)).

## Entradas e saídas manuais

| Rota | Descrição |
|---|---|
| `POST /api/stock/entries` | Entrada manual — `{ productId, storeId, quantity, unitCostCents?, batchNumber?, expiryDate? }`. `batchNumber`/`expiryDate` só fazem sentido se o produto é perecível (`isPerishable`) e o tenant tem `perishableTrackingEnabled`. |
| `POST /api/stock/exits` | Saída manual (perda/ajuste — **não** venda) — `{ productId, storeId, quantity, type: "saida_perda"\|"ajuste", reason, batchId? }`. `reason` é obrigatório para `saida_perda`. |

Toda escrita que lê/atualiza o saldo derivado de um `(tenant, produto, loja)` adquire um
`pg_advisory_xact_lock` antes de ler o saldo atual (`lockStockRow()` em `stock/balance.ts`) —
corrige uma race de lost-update/oversell sob concorrência (achado CR-1 da revisão HARDEN, ver
`Claude-Production-Grade-Suite/code-reviewer/findings/`). Transferências travam origem e destino
em ordem determinística para evitar deadlock.

## FEFO (First-Expired-First-Out)

`GET /api/stock/fefo-suggestion?productId=&storeId=&quantity=` — sugere a combinação de lotes a
sair primeiro, ordenada por vencimento, para uma quantidade solicitada. Retorna
`{ suggestions: [{ batchId, expiryDate, quantity }], fullyCovered }`. É **sugestão, não bloqueio**
(regra de negócio explícita do BRD) — ver [ADR-006](../architecture/architecture-decision-records/ADR-006-fefo-batch-tracking.md).
`POST /api/sales` aplica esta mesma lógica automaticamente quando um item de venda de produto
perecível omite `batchId`.

## Transferências entre lojas

`POST /api/transfers` — `{ originStoreId, destinationStoreId, items: [{ productId, batchId?, quantity }] }`.
Débito na origem + crédito no destino é atômico (uma transação Postgres).

## Importação de NF-e

Fluxo de 3 passos (ver [ADR-005](../architecture/architecture-decision-records/ADR-005-nfe-xml-import.md)
e [`sequence-nfe-import.md`](../architecture/system-diagrams/sequence-nfe-import.md)):

1. `POST /api/nfe-imports` (multipart, `{ file, storeId }`) — upload do XML SEFAZ
   (`nfeProc`/`procNFe`). Retorna `202 { importId }`; um job assíncrono (BullMQ) faz o parsing
   (`fast-xml-parser`) e persiste `nfe_imports` (`status=pending_review`) + um `nfe_import_items`
   por item (`cProd`, `cEAN`, `xProd`, `qCom`, `vUnComCents`, tentativa de match automático por
   `matchedProductId`).
2. `GET /api/nfe-imports/{importId}` — status e itens, usado para polling da UI enquanto o job
   roda. `status`: `pending_parse` -> `pending_review` -> `confirmed`/`discarded`/`failed`.
3. `POST /api/nfe-imports/{importId}/confirm` — **só neste momento** as movimentações de estoque
   são gravadas (critério de aceite do BRD: conferência antes de confirmar). Permite informar
   `batchNumber`/`expiryDate` por item perecível antes de confirmar. `409` se ainda há itens
   `unmatched` (não associados a um produto do catálogo).

Upload de XML tem limite de tamanho (`MAX_NFE_UPLOAD_BYTES` = 10 MiB, ver
[`libs/shared/src/storage/index.ts`](../../libs/shared/src/storage/index.ts)) — proteção contra um
tenant esgotar CPU/memória do worker compartilhado com um upload anormalmente grande (o worker é
processo único compartilhado por todos os tenants, ADR-001).

> **Armazenamento de arquivo:** hoje só existe `LocalFileStorage` (volume local, `UPLOADS_DIR`).
> A interface `FileStorage` foi desenhada para permitir uma implementação S3/MinIO no futuro (ver
> comentário em `storage/index.ts` e ADR-005), mas **essa implementação não existe hoje** — não
> documente/prometa suporte a S3 a consumidores da API.

## Alertas

| Rota | Descrição |
|---|---|
| `GET /api/alerts/low-stock` | Produtos abaixo do estoque mínimo (`minStockGlobal` ou override por loja) |
| `GET /api/alerts/expiring-batches` | Lotes vencendo dentro da janela configurada (30/15/7 dias), ordenados por proximidade |

Critério de aceite do BRD: um produto abaixo do mínimo deve aparecer nesta lista em até 60s após a
movimentação que o causou — SLO correspondente em
`Claude-Production-Grade-Suite/sre/slo/sli-definitions.yaml` (`job-alert-scan-slo`).

## Próximos passos

- [sales.md](./sales.md) — vendas debitam estoque automaticamente (FEFO quando aplicável).
- [Runbook: worker queue backlog](../runbooks/worker-queue-backlog-growing.md) — se imports/alertas pararem de processar.
