import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError, platformPrisma, withTenant } from "@estoque-saas/shared";
import { Prisma } from "@prisma/client";
import { hashPassword } from "./password";

export interface SignupInput {
  companyName: string;
  cnpj: string;
  adminName: string;
  adminEmail: string;
  password: string;
  planId: string;
}

export interface SignupResult {
  tenantId: string;
  userId: string;
}

// Onboarding self-service (BRD Epic 1 / api/openapi/auth.yaml#signup):
// cria tenant + primeiro usuário admin + assinatura em `trialing` numa única transação.
// paymentMethod da assinatura ainda não é conhecido neste passo (o usuário escolhe/paga depois via
// /api/billing/subscription) — gravamos um placeholder ('pix_boleto') que é substituído quando o
// tenant efetivamente assina um plano pago (modules/billing atualiza a MESMA linha, não cria outra).
export async function signupTenant(input: SignupInput): Promise<SignupResult> {
  const plan = await platformPrisma.plan.findUnique({ where: { id: input.planId } });
  if (!plan) {
    throw new NotFoundError("Plano não encontrado.");
  }

  const tenantId = randomUUID();
  const userId = randomUUID();
  const passwordHash = await hashPassword(input.password);

  try {
    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({
        data: { id: tenantId, name: input.companyName, cnpj: input.cnpj, planId: input.planId },
      });
      await tx.user.create({
        data: {
          id: userId,
          tenantId,
          name: input.adminName,
          email: input.adminEmail,
          passwordHash,
          role: "admin",
          status: "active",
        },
      });
      await tx.subscription.create({
        data: {
          tenantId,
          planId: input.planId,
          status: "trialing",
          paymentMethod: "pix_boleto",
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("CNPJ já cadastrado.", { field: "cnpj" });
    }
    throw err;
  }

  return { tenantId, userId };
}
