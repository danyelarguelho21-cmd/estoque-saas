import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/api/types";

/**
 * Amplia os tipos do Auth.js v5 com os campos que o módulo `auth` do backend (fase BUILD,
 * services/app/src/modules/auth) inclui na sessão/JWT: papel (RBAC) e tenant atual.
 * Mantido em sincronia manual com a implementação real do `authorize`/`callbacks.jwt`.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      tenantId: string;
      tenantName: string;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
    tenantId?: string;
    tenantName?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    tenantId?: string;
    tenantName?: string;
  }
}
