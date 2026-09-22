import { randomUUID } from "node:crypto";
import {
  ConflictError,
  NotFoundError,
  assertWithinPlanLimit,
  withTenant,
  type Role,
} from "@estoque-saas/shared";
import { Prisma } from "@prisma/client";

export interface InviteUserInput {
  name: string;
  email: string;
  role: Role;
}

export interface InviteUserResult {
  userId: string;
}

// Admin convida um novo usuário para o tenant — verifica limite de usuários do plano ANTES de
// criar (api/openapi/auth.yaml#inviteUser, BRD Epic 1). Usuário criado com status=invited (ainda
// sem senha própria — fluxo de definição de senha por convite é responsabilidade da camada de
// e-mail/UI, fora do escopo de backend puro coberto aqui; o status permite login ser bloqueado até
// ativação, ver check em login.ts/verifyLoginCredentials que exige status === 'active').
export async function inviteUser(tenantId: string, input: InviteUserInput): Promise<InviteUserResult> {
  // `tenants` é RLS-protegida (ADR-002) — leitura precisa passar por withTenant(), nunca
  // platformPrisma direto (bug real; ver modules/auth/tenant.ts#getTenantWithPlan).
  const tenant = await withTenant(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } }));
  if (!tenant) {
    throw new NotFoundError("Tenant não encontrado.");
  }

  const userId = randomUUID();

  try {
    await withTenant(tenantId, async (tx) => {
      const currentUserCount = await tx.user.count();
      assertWithinPlanLimit("users", currentUserCount, {
        maxProducts: tenant.plan.maxProducts,
        maxUsers: tenant.plan.maxUsers,
        maxStores: tenant.plan.maxStores,
      });

      await tx.user.create({
        data: {
          id: userId,
          tenantId,
          name: input.name,
          email: input.email,
          passwordHash: "", // definido no fluxo de aceite do convite (fora de escopo aqui)
          role: input.role,
          status: "invited",
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("E-mail já convidado/cadastrado neste tenant.", { field: "email" });
    }
    throw err;
  }

  return { userId };
}
