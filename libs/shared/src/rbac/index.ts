// RBAC — papéis de usuário de tenant (ver ADR-001, BRD Epic 1).
// admin: acesso total dentro do tenant. operador: catálogo/estoque, sem billing/usuários.
// vendedor: apenas vendas + consulta de estoque.

export const ROLES = ["admin", "operador", "vendedor"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

// Mapa de permissões por recurso/ação — usado por requireRole()/can() na camada HTTP.
// Definido de forma centralizada para que a regra de negócio "quem pode o quê" viva em um
// único lugar, não espalhada em cada Route Handler.
const PERMISSIONS = {
  "catalog:write": ["admin", "operador"],
  "catalog:read": ["admin", "operador", "vendedor"],
  "stock:write": ["admin", "operador"],
  "stock:read": ["admin", "operador", "vendedor"],
  "sales:write": ["admin", "operador", "vendedor"],
  "sales:read": ["admin", "operador", "vendedor"],
  "users:manage": ["admin"],
  "billing:manage": ["admin"],
  "tenant:manage": ["admin"],
  "dashboard:read": ["admin", "operador"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  const allowed: readonly Role[] = PERMISSIONS[permission];
  return allowed.includes(role);
}
