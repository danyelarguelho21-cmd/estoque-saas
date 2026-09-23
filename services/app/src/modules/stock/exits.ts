import { ValidationError, recordAudit, withTenant } from "@estoque-saas/shared";
import { lockStockRow, nextBalanceAfter } from "./balance";
import { resolveExitLines } from "./resolve-batches";

export interface StockExitInput {
  productId: string;
  storeId: string;
  quantity: number;
  type: "saida_perda" | "ajuste";
  reason?: string | undefined;
  batchId?: string | undefined;
}

export interface StockExitResult {
  movementIds: string[];
  balanceAfter: number;
}

// Saída de estoque por perda/quebra/ajuste — reason é OBRIGATÓRIO para saida_perda
// (api/openapi/stock.yaml#StockExitInput), auditado, e aplica FEFO automaticamente para produtos
// perecíveis quando nenhum lote é especificado (ADR-006).
export async function createStockExit(tenantId: string, userId: string, input: StockExitInput): Promise<StockExitResult> {
  if (input.type === "saida_perda" && !input.reason) {
    throw new ValidationError("O campo 'reason' é obrigatório para saida_perda.");
  }

  return withTenant(tenantId, async (tx) => {
    await lockStockRow(tx, tenantId, input.productId, input.storeId);

    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product) {
      throw new ValidationError("Produto não encontrado.");
    }

    const lines = await resolveExitLines(tx, input.productId, input.storeId, input.quantity, product.isPerishable, input.batchId);

    const movementIds: string[] = [];
    let balanceAfter = 0;

    for (const line of lines) {
      balanceAfter = await nextBalanceAfter(tx, input.productId, input.storeId, -line.quantity);

      const movement = await tx.stockMovement.create({
        data: {
          tenantId,
          productId: input.productId,
          storeId: input.storeId,
          batchId: line.batchId,
          type: input.type,
          quantity: -line.quantity,
          createdBy: userId,
          balanceAfter,
          metadata: {
            reason: input.reason ?? null,
            fefoApplied: line.fefoApplied,
            fefoOverridden: line.fefoOverridden,
          },
        },
      });

      if (line.batchId) {
        await tx.batch.update({ where: { id: line.batchId }, data: { quantity: { decrement: line.quantity } } });
      }

      movementIds.push(movement.id);

      await recordAudit(tx, {
        tenantId,
        userId,
        entityType: "stock_movement",
        entityId: movement.id,
        action: "create",
        after: { type: input.type, productId: input.productId, storeId: input.storeId, quantity: -line.quantity, reason: input.reason ?? null },
      });
    }

    return { movementIds, balanceAfter };
  });
}
