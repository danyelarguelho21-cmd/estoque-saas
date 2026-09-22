import { listActiveTenantIds, withTenant, type TenantScopedClient } from "@estoque-saas/shared";
import { getCurrentStock } from "./balance";

// Processor do job `scan-expiry-alerts` (worker, repeatable diário) — ADR-006 ponto 4: varre
// lotes vencendo dentro da janela configurada (stock_alerts_config.expiry_alert_days, default
// [30,15,7]) e gera notificações in-app. Também cobre alerta de estoque baixo (BRD Epic 6) na
// mesma varredura diária, já que ambos são "alertas configuráveis" do mesmo epic e evitam duas
// varreduras completas do catálogo por dia.
//
// Deduplicação: não cria uma nova notification para o MESMO lote/produto se já existe uma
// notification do mesmo tipo+referência criada nas últimas 20h (evita spam a cada execução do
// job caso rode mais de uma vez por dia).
export async function scanExpiryAndLowStockAlerts(): Promise<{ tenantsScanned: number; notificationsCreated: number }> {
  const tenantIds = await listActiveTenantIds();
  let notificationsCreated = 0;

  for (const tenantId of tenantIds) {
    notificationsCreated += await scanOneTenant(tenantId);
  }

  return { tenantsScanned: tenantIds.length, notificationsCreated };
}

async function alreadyNotifiedRecently(tx: TenantScopedClient, type: string, refKey: string, refValue: string): Promise<boolean> {
  const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const existing = await tx.notification.findFirst({
    where: {
      type,
      createdAt: { gte: twentyHoursAgo },
      payload: { path: [refKey], equals: refValue },
    },
  });
  return existing !== null;
}

async function scanOneTenant(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    let created = 0;

    const config = await tx.stockAlertsConfig.findUnique({ where: { tenantId } });
    const windowDays = Array.isArray(config?.expiryAlertDays) ? (config.expiryAlertDays as number[]) : [30, 15, 7];
    const maxWindow = Math.max(...windowDays, 30);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + maxWindow);

    const expiringBatches = await tx.batch.findMany({ where: { expiryDate: { lte: cutoff }, quantity: { gt: 0 } } });
    for (const batch of expiringBatches) {
      if (await alreadyNotifiedRecently(tx, "expiry", "batchId", batch.id)) continue;
      await tx.notification.create({
        data: {
          tenantId,
          type: "expiry",
          payload: { batchId: batch.id, productId: batch.productId, storeId: batch.storeId, expiryDate: batch.expiryDate.toISOString().slice(0, 10) },
        },
      });
      created++;
    }

    if (!config || config.lowStockAlertEnabled) {
      const products = await tx.product.findMany({ where: { deletedAt: null } });
      for (const product of products) {
        const currentStock = await getCurrentStock(tx, product.id);
        if (currentStock >= product.minStockGlobal) continue;
        if (await alreadyNotifiedRecently(tx, "low_stock", "productId", product.id)) continue;

        await tx.notification.create({
          data: { tenantId, type: "low_stock", payload: { productId: product.id, currentStock, minStock: product.minStockGlobal } },
        });
        created++;
      }
    }

    return created;
  });
}
