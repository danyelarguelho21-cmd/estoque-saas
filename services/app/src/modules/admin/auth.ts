import { UnauthorizedError, platformPrisma } from "@estoque-saas/shared";
import bcrypt from "bcryptjs";
import { createPlatformSession, destroyPlatformSession, getPlatformSession } from "./session";

// platform_admins não tem RLS (tabela global, ADR-002) — platformPrisma (role app_user) já
// enxerga a tabela inteira sem necessidade da role platform_admin_role para o login em si.
export async function platformAdminLogin(email: string, password: string): Promise<void> {
  const admin = await platformPrisma.platformAdmin.findUnique({ where: { email } });
  if (!admin) {
    throw new UnauthorizedError("E-mail ou senha inválidos.");
  }
  const matches = await bcrypt.compare(password, admin.passwordHash);
  if (!matches) {
    throw new UnauthorizedError("E-mail ou senha inválidos.");
  }
  await createPlatformSession(admin.id);
}

export async function platformAdminLogout(): Promise<void> {
  await destroyPlatformSession();
}

export interface PlatformAdminContext {
  adminId: string;
}

export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const session = await getPlatformSession();
  if (!session) {
    throw new UnauthorizedError();
  }
  return { adminId: session.adminId };
}
