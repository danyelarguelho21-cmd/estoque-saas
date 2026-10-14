import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  assertWithinPlanLimit,
  escapeHtml,
  sendTransactionalEmail,
  withTenant,
  type Role,
} from "@estoque-saas/shared";
import { Prisma } from "@prisma/client";
import { hashPassword } from "./password";

// ---------------------------------------------------------------------------------------------
// Link de convite: token assinado (HMAC com AUTH_SECRET) com tenant, usuário e validade. Não
// precisa de tabela — o convite só pode ser usado enquanto o usuário estiver com status
// "invited"; depois de aceito (status "active") qualquer link antigo deixa de funcionar.
// ---------------------------------------------------------------------------------------------
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

function inviteSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET ausente — necessário para assinar convites.");
  return secret;
}

function signInvite(encoded: string): string {
  return createHmac("sha256", inviteSecret()).update(`invite:${encoded}`).digest("base64url");
}

export function createInviteToken(tenantId: string, userId: string): string {
  const encoded = Buffer.from(JSON.stringify({ t: tenantId, u: userId, exp: Date.now() + INVITE_TTL_MS }), "utf8").toString("base64url");
  return `${encoded}.${signInvite(encoded)}`;
}

function readInviteToken(token: string): { tenantId: string; userId: string } | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(signInvite(encoded));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { t?: string; u?: string; exp?: number };
    if (!payload.t || !payload.u || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return { tenantId: payload.t, userId: payload.u };
  } catch {
    return null;
  }
}

export function buildInviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/convite?token=${encodeURIComponent(token)}`;
}

async function sendInviteEmail(to: string, name: string, tenantName: string, inviteUrl: string, inviterName?: string): Promise<void> {
  await sendTransactionalEmail({
    to,
    subject: `Você foi convidado para a ${tenantName} na Zolo`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#132524">
        <p>Olá, ${escapeHtml(name)}!</p>
        <p>${inviterName ? `<strong>${escapeHtml(inviterName)}</strong> convidou você` : "Você foi convidado"} para acessar o sistema de estoque da <strong>${escapeHtml(tenantName)}</strong> na Zolo.</p>
        <p>Clique no botão abaixo para criar sua senha e entrar:</p>
        <p style="margin:28px 0">
          <a href="${inviteUrl}" style="background:#8fe35b;color:#0a1406;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:bold">Aceitar convite</a>
        </p>
        <p style="font-size:13px;color:#5f7065">Se o botão não funcionar, copie e cole este link no navegador:<br>${inviteUrl}</p>
        <p style="font-size:13px;color:#5f7065">O convite vale por 7 dias.</p>
      </div>
    `,
  });
}

export interface InviteContext {
  /** URL pública do sistema (ex.: https://usezolo.com.br) para montar o link do convite. */
  baseUrl: string;
  inviterName?: string | undefined;
}

export interface InviteUserInput {
  name: string;
  email: string;
  role: Role;
}

export interface InviteUserResult {
  userId: string;
  /** Link de aceite — também devolvido ao admin para poder mandar por WhatsApp. */
  inviteUrl?: string;
}

// Admin convida um novo usuário para o tenant — verifica limite de usuários do plano ANTES de
// criar (api/openapi/auth.yaml#inviteUser, BRD Epic 1). Usuário criado com status=invited (ainda
// sem senha própria — fluxo de definição de senha por convite é responsabilidade da camada de
// e-mail/UI, fora do escopo de backend puro coberto aqui; o status permite login ser bloqueado até
// ativação, ver check em login.ts/verifyLoginCredentials que exige status === 'active').
export async function inviteUser(tenantId: string, input: InviteUserInput, context?: InviteContext): Promise<InviteUserResult> {
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

  if (!context) return { userId };
  const inviteUrl = buildInviteUrl(context.baseUrl, createInviteToken(tenantId, userId));
  await sendInviteEmail(input.email, input.name, tenant.name, inviteUrl, context.inviterName);
  return { userId, inviteUrl };
}

// Reenvia o convite de um usuário ainda pendente (gera um link novo e manda o e-mail de novo).
export async function resendInvite(tenantId: string, userId: string, context: InviteContext): Promise<{ inviteUrl: string }> {
  const { user, tenantName } = await withTenant(tenantId, async (tx) => {
    const found = await tx.user.findFirst({ where: { id: userId } });
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
    return { user: found, tenantName: tenant.name };
  });
  if (!user) throw new NotFoundError("Usuário não encontrado.");
  if (user.status !== "invited") throw new ConflictError("Este usuário já aceitou o convite.");
  const inviteUrl = buildInviteUrl(context.baseUrl, createInviteToken(tenantId, userId));
  await sendInviteEmail(user.email, user.name, tenantName, inviteUrl, context.inviterName);
  return { inviteUrl };
}

export interface InviteInfo {
  name: string;
  email: string;
  tenantName: string;
}

async function loadPendingInvite(token: string) {
  const parsed = readInviteToken(token);
  if (!parsed) throw new ValidationError("Convite inválido ou expirado. Peça um novo convite ao administrador.");
  const data = await withTenant(parsed.tenantId, async (tx) => {
    const user = await tx.user.findFirst({ where: { id: parsed.userId } });
    const tenant = await tx.tenant.findUnique({ where: { id: parsed.tenantId }, select: { name: true } });
    return { user, tenantName: tenant?.name ?? "" };
  });
  if (!data.user || data.user.status !== "invited") {
    throw new ValidationError("Este convite já foi usado ou não existe mais. Tente entrar com seu e-mail e senha.");
  }
  return { ...parsed, user: data.user, tenantName: data.tenantName };
}

export async function getInviteInfo(token: string): Promise<InviteInfo> {
  const invite = await loadPendingInvite(token);
  return { name: invite.user.name, email: invite.user.email, tenantName: invite.tenantName };
}

// Convidado define a própria senha — o usuário passa a "active" e já pode entrar.
export async function acceptInvite(token: string, password: string): Promise<{ email: string }> {
  if (password.length < 8) throw new ValidationError("A senha precisa ter pelo menos 8 caracteres.");
  const invite = await loadPendingInvite(token);
  const passwordHash = await hashPassword(password);
  await withTenant(invite.tenantId, (tx) =>
    tx.user.update({ where: { id: invite.userId }, data: { passwordHash, status: "active" } }),
  );
  return { email: invite.user.email };
}
