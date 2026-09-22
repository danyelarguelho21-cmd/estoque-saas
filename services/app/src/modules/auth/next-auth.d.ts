// Augmenta os tipos do next-auth@5 com os campos de domínio que carregamos no JWT/sessão
// (tenantId, role) — ver auth.config.ts. Sem isto, `session.user.tenantId` não tipa.
import type { Role } from "@estoque-saas/shared";

declare module "next-auth" {
  interface User {
    tenantId?: string;
    role?: Role;
  }

  interface Session {
    user: {
      id?: string | undefined;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      tenantId: string;
      role: Role;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    tenantId?: string;
    role?: Role;
  }
}
