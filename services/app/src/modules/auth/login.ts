// Lookup de login cross-tenant — ver schemas/migrations/0004_auth_lookup_function.sql para o
// racional completo (função SECURITY DEFINER estreita, chamada via platformPrisma.$queryRaw
// porque em login ainda não sabemos o tenant_id — RLS normal não pode ser usada ainda).
import { platformPrisma } from "@estoque-saas/shared";
import type { Role } from "@estoque-saas/shared";
import { verifyPassword } from "./password";

interface AuthLookupRow {
  tenant_id: string;
  user_id: string;
  name: string;
  password_hash: string;
  role: string;
  status: string;
  tenant_status: string;
}

export interface AuthenticatedUser {
  tenantId: string;
  userId: string;
  name: string;
  role: Role;
}

// Retorna o usuário autenticado, ou null se credenciais inválidas / conta desabilitada / tenant
// suspenso. Nunca lança para "credenciais erradas" (evita vazar timing/detalhe via stack) — apenas
// para falhas de infraestrutura genuínas.
export async function verifyLoginCredentials(email: string, plainPassword: string): Promise<AuthenticatedUser | null> {
  const rows = await platformPrisma.$queryRaw<AuthLookupRow[]>`SELECT * FROM auth_lookup_user_by_email(${email})`;

  for (const row of rows) {
    if (row.status !== "active") continue;
    if (row.tenant_status !== "active") continue;
    const matches = await verifyPassword(plainPassword, row.password_hash);
    if (matches) {
      return { tenantId: row.tenant_id, userId: row.user_id, name: row.name, role: row.role as Role };
    }
  }
  return null;
}
