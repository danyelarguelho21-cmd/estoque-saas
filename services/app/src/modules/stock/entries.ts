import { recordAudit, withTenant } from "@estoque-saas/shared";
import { lockStockRow, nextBalanceAfter } from "./balance";

export interface ManualEntryInput {
  productId: string;
  storeId: string;
  quantity: number;
  unitCostCents?: number | undefined;
  batchNumber?: string | undefined;
  expiryDate?: string | undefined; // ISO date
}

export interface ManualEntryResult {
  movementId: string;
  balanceAfter: number;
  batchId: string | null;
}

// Entrada manual de estoque (api/openapi/stock.yaml#createManualEntry). Se batchNumber+expiryDate
// forem informados, cria/credita um lote (ADR-006) — usado por produtos perecíveis.
export async function createManualEntry(
  tenantId: string,
  userId: string,
  input: ManualEntryInput,
): Promise<ManualEntryResult> {
  return withTenant(tenantId, async (tx) => {
    await lockStockRow(tx, tenantId, input.productId, input.storeId);

    let batchId: string | null = null;

    if (input.batchNumber && input.expiryDate) {
      const batch = await tx.batch.create({
        data: {
          tenantId,
          productId: input.productId,
          storeId: input.storeId,
          batchNumber: input.batchNumber,
          expiryDate: new Date(input.expiryDate),
          quantity: input.quantity,
        },
      });
      batchId = batch.id;
    }

    const balanceAfter = await nextBalanceAfter(tx, input.productId, input.storeId, input.quantity);

    const movement = await tx.stockMovement.create({
      data: {
        tenantId,
        productId: input.productId,
        storeId: input.storeId,
        batchId,
        type: "entrada_manual",
        quantity: input.quantity,
        unitCostCents: input.unitCostCents ?? null,
        createdBy: userId,
        balanceAfter,
      },
    });

    await recordAudit(tx, {
      tenantId,
      userId,
      entityType: "stock_movement",
      entityId: movement.id,
      action: "create",
      after: { type: "entrada_manual", productId: input.productId, storeId: input.storeId, quantity: input.quantity },
    });

    return { movementId: movement.id, balanceAfter, batchId };
  });
}
