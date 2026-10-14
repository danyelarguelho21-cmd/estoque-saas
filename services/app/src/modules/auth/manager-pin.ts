// Senha do gestor (PIN) — protege o faturamento e o painel do papel "vendedor".
//
// - admin e operador continuam vendo tudo normalmente (o painel já era deles).
// - vendedor só vê faturamento/painel depois que um gestor digita o PIN no aparelho. O PIN libera
//   por tempo limitado (UNLOCK_TTL_MS) via cookie httpOnly assinado (HMAC com AUTH_SECRET),
//   amarrado ao tenant E ao usuário logado — trocar de usuário no mesmo navegador não herda a
//   liberação.
// - O PIN fica só como hash bcrypt em tenants.manager_pin_hash e nunca sai da API.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { ForbiddenError, ValidationError, isSecureDeployment, recordAudit, withTenant } from "@estoque-saas/shared";
import { hashPassword, verifyPassword } from "./password";
import { requireSession, type SessionContext } from "./rbac";

const isSecure = isSecureDeployment();
const COOKIE_NAME = isSecure ? "__Host-zolo-manager" : "zolo-manager-dev";
export const UNLOCK_TTL_MS = 30 * 60 * 1000; // 30 minutos

const PIN_REGEX = /^\d{4,8}$/;

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET ausente — necessário para assinar a liberação do gestor.");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(`manager-unlock:${payload}`).digest("hex");
}

/** Papéis que enxergam faturamento sem precisar do PIN. */
export function roleHasFinancialAccess(role: SessionContext["role"]): boolean {
  return role === "admin" || role === "operador";
}

export async function getManagerPinConfigured(tenantId: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { managerPinHash: true } });
    return Boolean(tenant.managerPinHash);
  });
}

export async function setManagerPin(tenantId: string, userId: string, pin: string | null): Promise<void> {
  if (pin !== null && !PIN_REGEX.test(pin)) {
    throw new ValidationError("A senha do gestor deve ter de 4 a 8 números.");
  }
  const hash = pin === null ? null : await hashPassword(pin);
  await withTenant(tenantId, async (tx) => {
    await tx.tenant.update({ where: { id: tenantId }, data: { managerPinHash: hash } });
    await recordAudit(tx, {
      tenantId,
      userId,
      entityType: "tenant",
      entityId: tenantId,
      action: "update",
      after: { managerPin: pin === null ? "removida" : "definida" },
    });
  });
}

async function verifyManagerPin(tenantId: string, pin: string): Promise<boolean> {
  const hash = await withTenant(tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { managerPinHash: true } });
    return tenant.managerPinHash;
  });
  if (!hash) return false;
  return verifyPassword(pin, hash);
}

/** Confere o PIN e grava o cookie de liberação. Retorna a data em que a liberação expira. */
export async function unlockWithManagerPin(ctx: SessionContext, pin: string): Promise<Date> {
  if (!PIN_REGEX.test(pin) || !(await verifyManagerPin(ctx.tenantId, pin))) {
    throw new ForbiddenError("Senha do gestor incorreta.");
  }
  const exp = Date.now() + UNLOCK_TTL_MS;
  const encoded = Buffer.from(JSON.stringify({ t: ctx.tenantId, u: ctx.userId, exp }), "utf8").toString("base64url");
  const store = await cookies();
  store.set(COOKIE_NAME, `${encoded}.${sign(encoded)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecure,
    maxAge: UNLOCK_TTL_MS / 1000,
  });
  return new Date(exp);
}

export async function lockManagerArea(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** Data de expiração da liberação válida para este usuário/tenant, ou null. */
export async function getManagerUnlockExpiry(ctx: SessionContext): Promise<Date | null> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(COOKIE_NAME)?.value;
  } catch {
    return null; // fora de um request HTTP (ex.: testes chamando o handler direto) = sem liberação
  }
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { t?: string; u?: string; exp?: number };
    if (payload.t !== ctx.tenantId || payload.u !== ctx.userId || typeof payload.exp !== "number") return null;
    if (payload.exp <= Date.now()) return null;
    return new Date(payload.exp);
  } catch {
    return null;
  }
}

export async function hasFinancialAccess(ctx: SessionContext): Promise<boolean> {
  if (roleHasFinancialAccess(ctx.role)) return true;
  return (await getManagerUnlockExpiry(ctx)) !== null;
}

/** Para rotas de faturamento/painel: sessão válida + (admin/operador OU PIN do gestor liberado). */
export async function requireFinancialAccess(): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!(await hasFinancialAccess(ctx))) {
    throw new ForbiddenError("Área do gestor — digite a senha do gestor para ver o faturamento.");
  }
  return ctx;
}
