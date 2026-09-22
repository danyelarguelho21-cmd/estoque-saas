import { recordAudit, withTenant } from "@estoque-saas/shared";

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

// Usado por checagens de limite de plano em outros módulos (catalog, billing) — SEMPRE via
// withTenant(), nunca platformPrisma: `tenants` É uma tabela RLS-protegida (política
// `id = current_setting('app.tenant_id', true)::uuid`, ver ADR-002/0008_enable_row_level_
// security.sql) — `plans` (o include) é que não é RLS-scoped, não `tenants` em si.
//
// BUG REAL encontrado testando via Docker de verdade (não capturado por typecheck/testes
// unitários, só aparece contra Postgres real com RLS habilitado): esta função e cópias inline
// idênticas em modules/catalog/products.ts e modules/billing/subscriptions.ts usavam
// `platformPrisma` diretamente — sem nenhuma transação com `set_config('app.tenant_id', ...)`,
// a política RLS de `tenants` nunca via um `app.tenant_id` setado, então TODA leitura era
// filtrada para zero linhas (current_setting(..., true) = NULL nessa conexão) e
// `findUniqueOrThrow` sempre lançava "No record was found" — criar produto/loja/assinatura
// quebrava para QUALQUER tenant, sempre, não é um caso de borda de isolamento entre tenants.
export async function getTenantWithPlan(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { plan: true } }));
}
