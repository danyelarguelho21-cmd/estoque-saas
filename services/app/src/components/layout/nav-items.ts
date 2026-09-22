import {
  LayoutDashboard,
  Package,
  Boxes,
  ShoppingCart,
  Users,
  CreditCard,
} from "lucide-react";
import type { Permission } from "@/lib/rbac";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
  matchPrefix?: boolean;
}

/** Itens visíveis apenas se `can(permission)` — RBAC de defesa em profundidade na UI. */
export const TENANT_NAV_ITEMS: NavItem[] = [
  { href: "/painel", label: "Painel", icon: LayoutDashboard },
  { href: "/produtos", label: "Produtos", icon: Package, permission: "catalog:manage", matchPrefix: true },
  { href: "/estoque", label: "Estoque", icon: Boxes, permission: "stock:entry", matchPrefix: true },
  { href: "/vendas", label: "Vendas", icon: ShoppingCart, permission: "sales:view", matchPrefix: true },
  { href: "/configuracoes/usuarios", label: "Usuários e lojas", icon: Users, permission: "users:manage", matchPrefix: true },
  { href: "/assinatura", label: "Assinatura", icon: CreditCard, permission: "billing:manage" },
];
