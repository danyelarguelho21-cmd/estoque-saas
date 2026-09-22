// Augmenta os tipos do next-auth@5 com os campos de domínio que carregamos no JWT/sessão
// (tenantId, tenantName, role) — ver auth.config.ts. Sem isto, `session.user.tenantId` não tipa.
// Única declaração desses módulos no projeto — um segundo arquivo de augmentation
// (services/app/src/types/next-auth.d.ts) existia em paralelo após o merge das Waves de Backend
// e Frontend (cada agente criou o seu, cegos um ao outro) e foi removido para evitar dois "source
// of truth" incompatíveis (o duplicado tinha `id` obrigatório e `tenantName`, mas a implementação
// real de auth.config.ts nem populava tenantName ainda — corrigido aqui e lá, nesta consolidação).
import type { DefaultSession } from "next-auth";
import type { Role } from "@estoque-saas/shared";

declare module "next-auth" {
  interface User {
    tenantId?: string;
    tenantName?: string;
    role?: Role;
  }

  interface Session {
    user: {
      id: string;
      tenantId: string;
      tenantName: string;
      role: Role;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    tenantId?: string;
    tenantName?: string;
    role?: Role;
  }
}
