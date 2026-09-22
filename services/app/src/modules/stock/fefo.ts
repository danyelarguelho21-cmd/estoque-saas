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
//
// requestedQuantity <= 0 lança (não retorna vazio silenciosamente): o contrato de
// api/openapi/stock.yaml já exige `quantity: { minimum: 1 }` na rota que chama esta função — se
// este pré-condição for violada aqui, é sinal de um bug upstream (ex: um form que deveria ter
// bloqueado envio com quantidade 0), e falhar alto é preferível a mascarar isso com um resultado
// "vazio" que parece válido. Alinhado ao teste de aceite QA-owned (tests/unit/stock/fefo.test.ts,
// AC-003/ADR-006) — encontrado divergente do teste unitário deste mesmo arquivo durante o
// merge-back da Wave A e reconciliado a favor do oracle do QA (loop-protocol Rule 4).
export function suggestFefoBatches(batches: readonly FefoBatchInput[], requestedQuantity: number): FefoSuggestionResult {
  if (requestedQuantity <= 0) {
    throw new Error(`suggestFefoBatches: requestedQuantity deve ser >= 1 (recebido: ${requestedQuantity}).`);
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
