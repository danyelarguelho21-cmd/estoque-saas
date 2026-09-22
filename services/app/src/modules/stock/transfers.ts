import { ValidationError, recordAudit, withTenant, type TenantScopedClient } from "@estoque-saas/shared";
import { nextBalanceAfter } from "./balance";
import { resolveExitLines } from "./resolve-batches";

export interface TransferItemInput {
  productId: string;
  batchId?: string | undefined;
  quantity: number;
}

export interface TransferInput {
  originStoreId: string;
  destinationStoreId: string;
  items: TransferItemInput[];
}

export interface TransferResult {
  transferId: string;
}

// Transferência entre lojas/depósitos — débito na origem + crédito no destino em UMA transação
// (api/openapi/stock.yaml#createTransfer): withTenant() já abre uma única transação Prisma para
// toda a função, então qualquer falha em qualquer item causa rollback de TUDO (nenhuma
// transferência fica "pela metade"). Para produtos perecíveis, o lote "se move": decrementa o lote
// de origem e credita (ou cria) o lote correspondente (mesmo batch_number/expiry) no destino.
export async function createTransfer(tenantId: string, userId: string, input: TransferInput): Promise<TransferResult> {
  if (input.originStoreId === input.destinationStoreId) {
    throw new ValidationError("Loja de origem e destino não podem ser a mesma.");
  }
  if (input.items.length === 0) {
    throw new ValidationError("A transferência precisa de ao menos um item.");
  }

  return withTenant(tenantId, async (tx) => {
    const transfer = await tx.transfer.create({
      data: {
        tenantId,
        originStoreId: input.originStoreId,
        destinationStoreId: input.destinationStoreId,
        status: "completed",
        createdBy: userId,
      },
    });

    for (const item of input.items) {
      await transferOneItem(tx, tenantId, userId, transfer.id, input.originStoreId, input.destinationStoreId, item);
    }

    await recordAudit(tx, {
      tenantId,
      userId,
      entityType: "transfer",
      entityId: transfer.id,
      action: "create",
      after: { originStoreId: input.originStoreId, destinationStoreId: input.destinationStoreId, itemCount: input.items.length },
    });

    return { transferId: transfer.id };
  });
}

async function transferOneItem(
  tx: TenantScopedClient,
  tenantId: string,
  userId: string,
  transferId: string,
  originStoreId: string,
  destinationStoreId: string,
  item: TransferItemInput,
): Promise<void> {
  const product = await tx.product.findUnique({ where: { id: item.productId } });
  if (!product) {
    throw new ValidationError("Produto não encontrado.", { productId: item.productId });
  }

  const lines = await resolveExitLines(tx, item.productId, originStoreId, item.quantity, product.isPerishable, item.batchId);

  for (const line of lines) {
    // Débito na origem
    const originBalanceAfter = await nextBalanceAfter(tx, item.productId, originStoreId, -line.quantity);
    await tx.stockMovement.create({
      data: {
        tenantId,
        productId: item.productId,
        storeId: originStoreId,
        batchId: line.batchId,
        type: "transferencia_saida",
        quantity: -line.quantity,
        referenceId: transferId,
        createdBy: userId,
        balanceAfter: originBalanceAfter,
      },
    });

    let destinationBatchId: string | null = null;
    if (line.batchId) {
      const originBatch = await tx.batch.findUniqueOrThrow({ where: { id: line.batchId } });
      await tx.batch.update({ where: { id: line.batchId }, data: { quantity: { decrement: line.quantity } } });

      const existingDestinationBatch = await tx.batch.findFirst({
        where: { productId: item.productId, storeId: destinationStoreId, batchNumber: originBatch.batchNumber },
      });
      if (existingDestinationBatch) {
        await tx.batch.update({ where: { id: existingDestinationBatch.id }, data: { quantity: { increment: line.quantity } } });
        destinationBatchId = existingDestinationBatch.id;
      } else {
        const newBatch = await tx.batch.create({
          data: {
            tenantId,
            productId: item.productId,
            storeId: destinationStoreId,
            batchNumber: originBatch.batchNumber,
            expiryDate: originBatch.expiryDate,
            quantity: line.quantity,
          },
        });
        destinationBatchId = newBatch.id;
      }
    }

    // Crédito no destino
    const destinationBalanceAfter = await nextBalanceAfter(tx, item.productId, destinationStoreId, line.quantity);
    await tx.stockMovement.create({
      data: {
        tenantId,
        productId: item.productId,
        storeId: destinationStoreId,
        batchId: destinationBatchId,
        type: "transferencia_entrada",
        quantity: line.quantity,
        referenceId: transferId,
        createdBy: userId,
        balanceAfter: destinationBalanceAfter,
      },
    });

    await tx.transferItem.create({
      data: {
        tenantId,
        transferId,
        productId: item.productId,
        batchId: line.batchId,
        quantity: line.quantity,
      },
    });
  }
}
