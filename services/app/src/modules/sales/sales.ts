import { ValidationError, recordAudit, withTenant } from "@estoque-saas/shared";
import { getCurrentStock, lockStockRow, resolveExitLines } from "@/modules/stock";

export interface SaleItemInput {
  productId: string;
  batchId?: string | undefined;
  quantity: number;
  unitPriceCents: number;
}

export interface SaleInput {
  storeId: string;
  customerId?: string | undefined;
  paymentMethodLabel?: string | undefined;
  items: SaleItemInput[];
}

export interface SaleResult {
  saleId: string;
  totalAmountCents: number;
}

// Registra venda — debita estoque automaticamente, aplicando FEFO quando o produto é perecível e
// nenhum lote foi especificado (api/openapi/sales.yaml#createSale). Retorna 409 (via
// resolveExitLines -> ConflictError) se o estoque não cobrir algum item — tudo em UMA transação
// (withTenant), então nenhuma venda fica parcialmente debitada.
export async function createSale(tenantId: string, userId: string, input: SaleInput): Promise<SaleResult> {
  if (input.items.length === 0) {
    throw new ValidationError("A venda precisa de ao menos um item.");
  }

  return withTenant(tenantId, async (tx) => {
    const totalAmountCents = input.items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0);

    const sale = await tx.sale.create({
      data: {
        tenantId,
        storeId: input.storeId,
        customerId: input.customerId ?? null,
        sellerId: userId,
        totalAmountCents,
        paymentMethodLabel: input.paymentMethodLabel ?? null,
        status: "completed",
      },
    });

    for (const item of input.items) {
      await lockStockRow(tx, tenantId, item.productId, input.storeId);

      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) {
        throw new ValidationError("Produto não encontrado.", { productId: item.productId });
      }

      const lines = await resolveExitLines(tx, item.productId, input.storeId, item.quantity, product.isPerishable, item.batchId);

      for (const line of lines) {
        const balanceAfter = (await getCurrentStock(tx, item.productId, input.storeId)) - line.quantity;

        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: item.productId,
            storeId: input.storeId,
            batchId: line.batchId,
            type: "saida_venda",
            quantity: -line.quantity,
            referenceId: sale.id,
            createdBy: userId,
            balanceAfter,
            metadata: { fefoApplied: line.fefoApplied, fefoOverridden: line.fefoOverridden },
          },
        });

        if (line.batchId) {
          await tx.batch.update({ where: { id: line.batchId }, data: { quantity: { decrement: line.quantity } } });
        }

        await tx.saleItem.create({
          data: {
            tenantId,
            saleId: sale.id,
            productId: item.productId,
            batchId: line.batchId,
            quantity: line.quantity,
            unitPriceCents: item.unitPriceCents,
          },
        });
      }
    }

    await recordAudit(tx, {
      tenantId,
      userId,
      entityType: "sale",
      entityId: sale.id,
      action: "create",
      after: { storeId: input.storeId, totalAmountCents, itemCount: input.items.length },
    });

    return { saleId: sale.id, totalAmountCents };
  });
}

export interface ListSalesFilters {
  storeId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function listSales(tenantId: string, filters: ListSalesFilters) {
  const limit = filters.limit ?? 20;
  return withTenant(tenantId, async (tx) => {
    const where = {
      status: "completed" as const,
      ...(filters.storeId ? { storeId: filters.storeId } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };

    const sales = await tx.sale.findMany({
      where,
      include: { items: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = sales.length > limit;
    const page = hasMore ? sales.slice(0, limit) : sales;
    const totalAmountCents = page.reduce((sum, s) => sum + s.totalAmountCents, 0);

    return {
      items: page,
      page: { next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null, has_more: hasMore },
      totalAmountCents,
    };
  });
}

export async function getSale(tenantId: string, saleId: string) {
  return withTenant(tenantId, (tx) => tx.sale.findUnique({ where: { id: saleId }, include: { items: true } }));
}
