// Wrapper de auditoria (ADR-007) — toda mutação de domínio que precisa de trilha de auditoria
// passa por recordAudit(), garantindo que a linha de audit_log seja gravada na MESMA transação
// da mutação (atomicidade: ou os dois persistem, ou nenhum).
import type { Prisma } from "@prisma/client";
import type { TenantScopedClient } from "../db/client";

export interface AuditContext {
  tenantId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete";
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

// tx: cliente Prisma já dentro da transação de withTenant() (libs/shared/src/db/client.ts) —
// tipado contra o TransactionClient real do Prisma (não uma interface estrutural solta), para que
// o compilador pegue divergência de schema (ex: coluna renomeada) em vez de aceitar qualquer objeto
// com formato parecido.
export async function recordAudit(tx: TenantScopedClient, ctx: AuditContext): Promise<void> {
  const data: Prisma.AuditLogUncheckedCreateInput = {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    entityType: ctx.entityType,
    entityId: ctx.entityId,
    action: ctx.action,
  };
  if (ctx.before !== undefined) data.before = ctx.before;
  if (ctx.after !== undefined) data.after = ctx.after;
  await tx.auditLog.create({ data });
}
