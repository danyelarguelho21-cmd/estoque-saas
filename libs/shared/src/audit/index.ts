// Wrapper de auditoria (ADR-007) — toda mutação de domínio que precisa de trilha de auditoria
// passa por withAudit(), garantindo que a linha de audit_log seja gravada na MESMA transação
// da mutação (atomicidade: ou os dois persistem, ou nenhum).

export interface AuditContext {
  tenantId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete";
  before?: unknown;
  after?: unknown;
}

// tx: cliente Prisma já dentro da transação de withTenant() (libs/shared/src/db/client.ts)
export async function recordAudit(
  tx: { auditLog: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> } },
  ctx: AuditContext,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entityType: ctx.entityType,
      entityId: ctx.entityId,
      action: ctx.action,
      before: ctx.before ?? null,
      after: ctx.after ?? null,
    },
  });
}
