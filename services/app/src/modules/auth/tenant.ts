import { platformPrisma, recordAudit, withTenant } from "@estoque-saas/shared";

// api/openapi/tenants.yaml#getTenant / #updateTenant — tenant é RLS-scoped (usa a própria coluna
// id, ver ADR-002), então withTenant() funciona normalmente aqui apesar de ser "a própria linha".
export async function getTenant(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }));
}

export interface UpdateTenantInput {
  consolidatedStock?: boolean | undefined;
  perishableTrackingEnabled?: boolean | undefined;
}

export async function updateTenant(tenantId: string, userId: string, input: UpdateTenantInput) {
  return withTenant(tenantId, async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const updated = await tx.tenant.update({
      where: { id: tenantId },
      data: {
        ...(input.consolidatedStock !== undefined ? { consolidatedStock: input.consolidatedStock } : {}),
        ...(input.perishableTrackingEnabled !== undefined ? { perishableTrackingEnabled: input.perishableTrackingEnabled } : {}),
      },
    });
    await recordAudit(tx, {
      tenantId,
      userId,
      entityType: "tenant",
      entityId: tenantId,
      action: "update",
      before: { consolidatedStock: before.consolidatedStock, perishableTrackingEnabled: before.perishableTrackingEnabled },
      after: { consolidatedStock: updated.consolidatedStock, perishableTrackingEnabled: updated.perishableTrackingEnabled },
    });
    return updated;
  });
}

// Re-exportado por conveniência: leitura pública de plano (usada por checagens de limite em
// outros arquivos do módulo) — platformPrisma porque plans não é RLS-scoped (ADR-002).
export async function getTenantWithPlan(tenantId: string) {
  return platformPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { plan: true } });
}
