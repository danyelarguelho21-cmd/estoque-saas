import type { TenantScopedClient } from "@estoque-saas/shared";

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
