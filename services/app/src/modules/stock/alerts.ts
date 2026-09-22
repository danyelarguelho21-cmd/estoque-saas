import type { TenantScopedClient } from "@estoque-saas/shared";
import { withTenant } from "@estoque-saas/shared";
import { getCurrentStock } from "./balance";

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
export async function listLowStockAlerts(tenantId: string, storeId?: string): Promise<LowStockProduct[]> {
  return withTenant(tenantId, async (tx) => {
    const products = await tx.product.findMany({ where: { deletedAt: null } });
    const result: LowStockProduct[] = [];

    for (const product of products) {
      let minStock = product.minStockGlobal;
      if (storeId) {
        const override = await tx.productStoreSetting.findUnique({
          where: { productId_storeId: { productId: product.id, storeId } },
        });
        if (override?.minStockOverride !== null && override?.minStockOverride !== undefined) {
          minStock = override.minStockOverride;
        }
      }
      const currentStock = await getCurrentStock(tx, product.id, storeId);
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
