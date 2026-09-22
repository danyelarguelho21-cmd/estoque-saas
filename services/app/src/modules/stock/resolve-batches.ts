import { ConflictError, type TenantScopedClient } from "@estoque-saas/shared";
import { suggestFefoBatches, type FefoSuggestionItem } from "./fefo";
import { getCurrentStock } from "./balance";

export interface ResolvedExitLine {
  batchId: string | null;
  quantity: number;
  fefoApplied: boolean; // metadata: a saída seguiu (true) ou não usou (false, produto não perecível) FEFO
  fefoOverridden: boolean; // true quando o chamador especificou um batchId manualmente (sobrepôs a sugestão)
}

// Resolve como uma saída de `quantity` unidades de um produto numa loja deve ser dividida entre
// lotes — ADR-006: se o produto é perecível e nenhum batchId foi informado, aplica FEFO
// automaticamente (pode gerar múltiplas linhas de stock_movements, uma por lote). Se um batchId FOI
// informado, respeita a escolha manual do operador (fefoOverridden=true) sem consultar FEFO. Se o
// produto não é perecível, não há lote — verifica apenas saldo agregado.
//
// Lança ConflictError (409) se o estoque disponível não cobre a quantidade solicitada — atende ao
// critério de aceite de vendas (api/openapi/sales.yaml#createSale) e é aplicado também a
// saídas manuais (perda/ajuste) por consistência.
export async function resolveExitLines(
  tx: TenantScopedClient,
  productId: string,
  storeId: string,
  quantity: number,
  isPerishable: boolean,
  explicitBatchId?: string | undefined,
): Promise<ResolvedExitLine[]> {
  if (explicitBatchId) {
    const batch = await tx.batch.findUnique({ where: { id: explicitBatchId } });
    if (!batch || batch.quantity < quantity) {
      throw new ConflictError("Estoque insuficiente no lote selecionado.", { productId, batchId: explicitBatchId });
    }
    return [{ batchId: explicitBatchId, quantity, fefoApplied: false, fefoOverridden: true }];
  }

  if (!isPerishable) {
    const currentStock = await getCurrentStock(tx, productId, storeId);
    if (currentStock < quantity) {
      throw new ConflictError("Estoque insuficiente.", { productId, storeId, available: currentStock, requested: quantity });
    }
    return [{ batchId: null, quantity, fefoApplied: false, fefoOverridden: false }];
  }

  const batches = await tx.batch.findMany({
    where: { productId, storeId, quantity: { gt: 0 } },
    orderBy: { expiryDate: "asc" },
  });
  const suggestion = suggestFefoBatches(
    batches.map((b) => ({ batchId: b.id, expiryDate: b.expiryDate.toISOString().slice(0, 10), quantity: b.quantity })),
    quantity,
  );
  if (!suggestion.fullyCovered) {
    throw new ConflictError("Estoque insuficiente nos lotes disponíveis.", { productId, storeId, requested: quantity });
  }
  return suggestion.suggestions.map(
    (s: FefoSuggestionItem): ResolvedExitLine => ({
      batchId: s.batchId,
      quantity: s.quantity,
      fefoApplied: true,
      fefoOverridden: false,
    }),
  );
}
