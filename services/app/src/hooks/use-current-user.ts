"use client";

import { useSession } from "next-auth/react";
import { can, type Permission } from "@/lib/rbac";

/**
 * Wrapper fino sobre `useSession` (next-auth/react) — único ponto de leitura de
 * usuário/papel/tenant no client. Nunca decodifica cookie/JWT manualmente (Pattern 2).
 */
export function useCurrentUser() {
  const { data: session, status } = useSession();

  return {
    user: session?.user,
    role: session?.user.role,
    tenantId: session?.user.tenantId,
    tenantName: session?.user.tenantName,
    isLoading: status === "loading",
    isAuthenticated: status === "authenticated",
    can: (permission: Permission) => can(session?.user.role, permission),
  };
}
