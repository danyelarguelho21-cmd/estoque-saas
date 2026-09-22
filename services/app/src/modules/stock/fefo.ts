// FEFO (First-Expired-First-Out) — função pura, sem I/O (ADR-006).
// Dado o saldo de lotes de um produto/loja + a quantidade requisitada, retorna a combinação de
// lotes sugerida, dos mais próximos do vencimento para os mais distantes. Testável isoladamente,
// sem banco — a camada de domínio (stock/exits.ts, sales/sales.ts) busca os lotes via Prisma e
// passa aqui; é apenas sugestão (nunca bloqueante — BRD/ADR-006), a camada chamadora decide se
// aceita, sobrepõe manualmente, ou registra que a sugestão foi ignorada em stock_movements.metadata.

export interface FefoBatchInput {
  batchId: string;
  expiryDate: string; // ISO date (YYYY-MM-DD)
  quantity: number; // saldo atual do lote (deve ser > 0 para participar)
}

export interface FefoSuggestionItem {
  batchId: string;
  expiryDate: string;
  quantity: number; // quantidade sugerida a sair DESTE lote (<= saldo do lote)
}

export interface FefoSuggestionResult {
  suggestions: FefoSuggestionItem[];
  fullyCovered: boolean; // false se a soma dos lotes disponíveis não cobre a quantidade requisitada
}

// Pura: mesma entrada sempre produz a mesma saída. Não muta `batches`.
export function suggestFefoBatches(batches: readonly FefoBatchInput[], requestedQuantity: number): FefoSuggestionResult {
  if (requestedQuantity <= 0) {
    return { suggestions: [], fullyCovered: true };
  }

  const sorted = [...batches]
    .filter((b) => b.quantity > 0)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  const suggestions: FefoSuggestionItem[] = [];
  let remaining = requestedQuantity;

  for (const batch of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    suggestions.push({ batchId: batch.batchId, expiryDate: batch.expiryDate, quantity: take });
    remaining -= take;
  }

  return { suggestions, fullyCovered: remaining <= 0 };
}
