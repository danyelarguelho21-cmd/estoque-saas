import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError, escapeHtml, platformPrisma, sendTransactionalEmail, withTenant, type BillingAddress } from "@estoque-saas/shared";
import { Prisma } from "@prisma/client";
import { hashPassword } from "./password";
import { billingAddressToTenantData } from "./tenant";

export interface SignupInput {
  companyName: string;
  personType: "PF" | "PJ";
  cnpj: string | null;
  cpf: string | null;
  adminName: string;
  adminEmail: string;
  password: string;
  planId: string;
  billingAddress: BillingAddress;
}

export interface SignupResult {
  tenantId: string;
  userId: string;
}

// Onboarding self-service (BRD Epic 1 / api/openapi/auth.yaml#signup):
// cria tenant + primeiro usuário admin + assinatura em `trialing` numa única transação.
// Aceita pessoa jurídica (CNPJ) OU pessoa física (CPF) — personType decide qual dos dois é
// gravado; o outro fica NULL (o Zod na rota já garante que exatamente um dos dois chegou aqui).
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
        data: {
          id: tenantId,
          name: input.companyName,
          personType: input.personType,
          cnpj: input.cnpj,
          cpf: input.cpf,
          planId: input.planId,
          ...billingAddressToTenantData(input.billingAddress),
        },
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
      await tx.store.create({
        data: {
          tenantId,
          name: "Loja principal",
          type: "loja",
        },
      });
      // BUG FIX (achado em produção via teste manual real): este produto não tem período de
      // teste (BRD: pagar pra usar) — "pending_payment" bloqueia acesso pleno até o webhook do
      // PagBank confirmar o primeiro pagamento (ver rbac.ts's requireSession/requireRole).
      await tx.subscription.create({
        data: {
          tenantId,
          planId: input.planId,
          status: "pending_payment",
          paymentMethod: "pix_boleto",
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const field = input.personType === "PF" ? "cpf" : "cnpj";
      const label = input.personType === "PF" ? "CPF" : "CNPJ";
      throw new ConflictError(`${label} já cadastrado.`, { field });
    }
    throw err;
  }

  // Best-effort — sendTransactionalEmail nunca lança (ver libs/shared/src/email). Um provedor de
  // e-mail fora do ar não pode impedir a conclusão do cadastro; se falhar, fica só no log.
  await sendTransactionalEmail({
    to: input.adminEmail,
    subject: "Bem-vindo à Zolo",
    html: `
      <p>Olá, ${escapeHtml(input.adminName)}!</p>
      <p>Sua conta na Zolo foi criada com sucesso para <strong>${escapeHtml(input.companyName)}</strong>.</p>
      <p>Já pode acessar o sistema e começar a configurar seu estoque.</p>
    `,
  });

  return { tenantId, userId };
}
