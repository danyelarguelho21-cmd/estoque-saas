// Helpers de sessão/RBAC usados por Route Handlers de QUALQUER módulo (via modules/auth/index.ts —
// fronteira de módulo, ADR-001). Nunca reimplementar checagem de auth fora daqui
// (boundary-safety Pattern 2 — delegar ao controle de fluxo único, não duplicar).
import { ForbiddenError, UnauthorizedError, can, type Permission, type Role } from "@estoque-saas/shared";
import { auth } from "./auth.config";

export interface SessionContext {
  tenantId: string;
  userId: string;
  role: Role;
}

// Lança UnauthorizedError (401) se não houver sessão válida. Toda rota tenant-scoped chama isto
// primeiro, antes de qualquer acesso a dados.
export async function requireSession(): Promise<SessionContext> {
  const session = await auth();
  // Falha fechado explicitamente se QUALQUER campo esperado faltar — nunca degradar para um
  // valor default silencioso (ex: userId=""), que passaria despercebido pelo RBAC e só quebraria
  // mais tarde, de forma confusa, na primeira gravação em coluna uuid (audit_log, created_by...).
  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    throw new UnauthorizedError();
  }
  return {
    tenantId: session.user.tenantId,
    userId: session.user.id,
    role: session.user.role,
  };
}

// Exige sessão válida E a permissão informada — lança ForbiddenError (403) se o papel do usuário
// não tiver a permissão (ver libs/shared/src/rbac para o mapa papel→permissão).
export async function requireRole(permission: Permission): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!can(ctx.role, permission)) {
    throw new ForbiddenError();
  }
  return ctx;
}
