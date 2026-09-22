import type { Role } from "./api/types";

/**
 * RBAC no cliente — defesa em profundidade (esconder/desabilitar ações), NUNCA a única
 * camada: o backend reforça a mesma regra em cada Route Handler (design-principles.md).
 *
 * Papéis (BRD, Business Rules):
 * - admin: acesso total ao tenant, incluindo assinatura/cobrança e configurações.
 * - operador: catálogo, entradas, saídas, transferências, alertas — sem config/cobrança.
 * - vendedor: registrar vendas, consultar estoque e histórico de clientes — sem custos de
 *   fornecedor, configurações ou cobrança.
 */
export type Permission =
  | "settings:view"
  | "users:manage"
  | "stores:manage"
  | "billing:manage"
  | "catalog:manage"
  | "catalog:view-cost"
  | "stock:entry"
  | "stock:exit"
  | "stock:transfer"
  | "stock:nfe-import"
  | "sales:create"
  | "sales:view";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    "settings:view",
    "users:manage",
    "stores:manage",
    "billing:manage",
    "catalog:manage",
    "catalog:view-cost",
    "stock:entry",
    "stock:exit",
    "stock:transfer",
    "stock:nfe-import",
    "sales:create",
    "sales:view",
  ],
  operador: [
    "catalog:manage",
    "catalog:view-cost",
    "stock:entry",
    "stock:exit",
    "stock:transfer",
    "stock:nfe-import",
    "sales:view",
  ],
  vendedor: ["sales:create", "sales:view"],
};

export function can(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  operador: "Operador de estoque",
  vendedor: "Vendedor",
};
