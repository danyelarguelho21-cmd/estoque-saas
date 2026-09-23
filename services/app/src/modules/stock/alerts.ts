import type { TenantScopedClient } from "@estoque-saas/shared";
import { withTenant } from "@estoque-saas/shared";
import { getCurrentStockForProducts } from "./balance";

export interface LowStockProduct {
  id: string;
  sku: string;
  name: string;
  currentStock: number;
  minStock: number;
}

// Produtos abaixo do estoque mínimo (api/openapi/stock.yaml#listLowStockAlerts). Usa
// minStockOverride por loja quando storeId é informado e existir override; caso contrário,
// minStockGlobal do produto (schemas/erd.md — product_store_settings).
// code-reviewer finding HI-1: was a plain for...of loop doing up to 2 queries PER product
// (productStoreSetting.findUnique + getCurrentStock), unbounded by catalog size. Now 3 queries
// total regardless of catalog size: the product list, one batched productStoreSetting lookup,
// and one batched stock balance lookup (getCurrentStockForProducts).
export async function listLowStockAlerts(tenantId: string, storeId?: string): Promise<LowStockProduct[]> {
  return withTenant(tenantId, async (tx) => {
    const products = await tx.product.findMany({ where: { deletedAt: null } });
    const productIds = products.map((p) => p.id);

    const [overrides, stockByProduct] = await Promise.all([
      storeId
        ? tx.productStoreSetting.findMany({ where: { productId: { in: productIds }, storeId } })
        : Promise.resolve([]),
      getCurrentStockForProducts(tx, productIds, storeId),
    ]);
    const overrideByProductId = new Map(overrides.map((o) => [o.productId, o.minStockOverride]));

    const result: LowStockProduct[] = [];
    for (const product of products) {
      const override = overrideByProductId.get(product.id);
      const minStock = override !== null && override !== undefined ? override : product.minStockGlobal;
      const currentStock = stockByProduct.get(product.id) ?? 0;
      if (currentStock < minStock) {
        result.push({ id: product.id, sku: product.sku, name: product.name, currentStock, minStock });
      }
    }
    return result;
  });
}

export interface ExpiringBatch {
  id: string;
  productId: string;
  storeId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
}

// Lotes vencendo dentro da janela configurada (stock_alerts_config.expiry_alert_days, default
// [30,15,7]) — api/openapi/stock.yaml#listExpiringBatches. Ordenados por proximidade de vencimento.
export async function listExpiringBatches(tenantId: string, storeId?: string): Promise<ExpiringBatch[]> {
  return withTenant(tenantId, async (tx) => {
    const config = await tx.stockAlertsConfig.findUnique({ where: { tenantId } });
    const windowDays = Array.isArray(config?.expiryAlertDays) ? (config.expiryAlertDays as number[]) : [30, 15, 7];
    const maxWindow = Math.max(...windowDays, 30);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + maxWindow);

    const batches = await queryExpiringBatches(tx, cutoff, storeId);

    return batches
      .filter((b) => b.quantity > 0)
      .map((b) => ({
        id: b.id,
        productId: b.productId,
        storeId: b.storeId,
        batchNumber: b.batchNumber,
        expiryDate: b.expiryDate.toISOString().slice(0, 10),
        quantity: b.quantity,
      }));
  });
}

async function queryExpiringBatches(tx: TenantScopedClient, cutoff: Date, storeId?: string) {
  return tx.batch.findMany({
    where: {
      expiryDate: { lte: cutoff },
      ...(storeId ? { storeId } : {}),
    },
    orderBy: { expiryDate: "asc" },
  });
}
