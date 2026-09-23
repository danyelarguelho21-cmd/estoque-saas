import type { TenantScopedClient } from "@estoque-saas/shared";

// Trava de contenção para toda operação que lê o saldo atual e depois escreve um novo
// stock_movements com base nele (entrada, saída, venda, transferência, NF-e). Sem isto, duas
// transações concorrentes fazem a mesma leitura antes de qualquer uma comitar seu INSERT — lost
// update clássico no saldo derivado, e TOCTOU na checagem de suficiência de estoque
// (code-reviewer finding CR-1). pg_advisory_xact_lock é liberado automaticamente no
// commit/rollback da transação (nunca precisa de unlock manual) e serializa exatamente as
// operações que disputam o mesmo (tenant, produto, loja) — operações em produtos/lojas
// diferentes não se bloqueiam entre si.
//
// Deve ser a PRIMEIRA operação dentro do withTenant de qualquer caminho que leia/grave o saldo
// desse par (product, store) — inclusive antes da checagem de suficiência em resolveExitLines,
// que é o ponto onde o TOCTOU de "vender mais do que existe" ocorre.
export async function lockStockRow(tx: TenantScopedClient, tenantId: string, productId: string, storeId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId} || ${productId} || ${storeId}))`;
}

// Saldo de estoque não é materializado em tabela própria (schemas/erd.md "Notas de modelagem") —
// é derivado de stock_movements.balance_after, que cada movimento grava no momento da escrita
// (evita recomputar a soma de todo o histórico a cada leitura). O saldo ATUAL de um produto numa
// loja é o balance_after do movimento mais recente daquele par (product_id, store_id).
//
// Consolidado entre lojas (tenant.consolidatedStock) = soma do saldo mais recente de CADA loja.
export async function getCurrentStock(
  tx: TenantScopedClient,
  productId: string,
  storeId?: string,
): Promise<number> {
  // Duas variantes explícitas (em vez de montar SQL condicional por concatenação de string) —
  // todo parâmetro passa pelo binding seguro do template tagueado do Prisma, nunca por
  // interpolação direta de string (evita SQL injection).
  const rows = storeId
    ? await tx.$queryRaw<Array<{ store_id: string; balance_after: number }>>`
        SELECT DISTINCT ON (store_id) store_id, balance_after
        FROM stock_movements
        WHERE product_id = ${productId}::uuid AND store_id = ${storeId}::uuid
        ORDER BY store_id, created_at DESC
      `
    : await tx.$queryRaw<Array<{ store_id: string; balance_after: number }>>`
        SELECT DISTINCT ON (store_id) store_id, balance_after
        FROM stock_movements
        WHERE product_id = ${productId}::uuid
        ORDER BY store_id, created_at DESC
      `;
  return rows.reduce((sum, r) => sum + r.balance_after, 0);
}

// Próximo balance_after para um novo movimento: saldo atual do par (product, store) + delta
// (delta positivo para entradas, negativo para saídas — decidido pelo chamador).
export async function nextBalanceAfter(tx: TenantScopedClient, productId: string, storeId: string, delta: number): Promise<number> {
  const current = await getCurrentStock(tx, productId, storeId);
  return current + delta;
}

// code-reviewer finding HI-1: batched version of getCurrentStock() for the N+1 call sites
// (listLowStockAlerts, getStalledProducts, getStockTurnover, scanOneTenant's low-stock half,
// listProducts) that were calling getCurrentStock() once PER PRODUCT in a loop — same
// DISTINCT-ON-per-(product,store) technique, parameterized over the whole product-id set at once
// (WHERE product_id = ANY($1)) instead of one round-trip per product. Same total query cost as a
// SINGLE getCurrentStock() call today, O(1) queries instead of O(n). Returns a Map so callers can
// look up each product's balance by id; a product with zero movements simply has no entry (callers
// should default to 0, matching getCurrentStock's own empty-array-sums-to-0 behavior).
export async function getCurrentStockForProducts(
  tx: TenantScopedClient,
  productIds: string[],
  storeId?: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (productIds.length === 0) return result;

  const rows = storeId
    ? await tx.$queryRaw<Array<{ product_id: string; store_id: string; balance_after: number }>>`
        SELECT DISTINCT ON (product_id, store_id) product_id, store_id, balance_after
        FROM stock_movements
        WHERE product_id = ANY(${productIds}::uuid[]) AND store_id = ${storeId}::uuid
        ORDER BY product_id, store_id, created_at DESC
      `
    : await tx.$queryRaw<Array<{ product_id: string; store_id: string; balance_after: number }>>`
        SELECT DISTINCT ON (product_id, store_id) product_id, store_id, balance_after
        FROM stock_movements
        WHERE product_id = ANY(${productIds}::uuid[])
        ORDER BY product_id, store_id, created_at DESC
      `;

  for (const row of rows) {
    result.set(row.product_id, (result.get(row.product_id) ?? 0) + row.balance_after);
  }
  return result;
}
