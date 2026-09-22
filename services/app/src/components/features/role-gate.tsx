"use client";

import type { ReactNode } from "react";
import { useCurrentUser } from "@/hooks/use-current-user";
import type { Permission } from "@/lib/rbac";

interface RoleGateProps {
  permission: Permission;
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Defesa em profundidade no cliente: esconde/substitui ações que o papel atual não pode
 * executar. NUNCA é a única camada — o backend reforça a mesma regra em cada Route Handler
 * (design-principles.md, "defesa em profundidade").
 */
export function RoleGate({ permission, fallback = null, children }: RoleGateProps) {
  const { can } = useCurrentUser();
  if (!can(permission)) return <>{fallback}</>;
  return <>{children}</>;
}
