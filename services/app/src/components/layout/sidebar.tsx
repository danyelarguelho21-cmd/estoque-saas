"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarSupportCard } from "@/components/layout/whatsapp-support";
import { useCurrentUser } from "@/hooks/use-current-user";
import { TENANT_NAV_ITEMS } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const { can } = useCurrentUser();
  const visibleItems = TENANT_NAV_ITEMS.filter((item) => !item.permission || can(item.permission));
  // Destaca só o item mais específico (ex.: /vendas/clientes ativa "Clientes", não "Vendas").
  const activeHref = visibleItems
    .filter((item) => (item.matchPrefix ? pathname.startsWith(item.href) : pathname === item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav aria-label="Navegação principal" className={cn("flex h-full flex-col gap-1 p-4", className)}>
      <Link href="/painel" className="mb-6 flex items-center gap-2 px-2 text-base font-semibold text-slate-900">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-primary)] text-base font-extrabold text-[var(--color-primary-foreground)] shadow-[0_0_24px_rgb(143_227_91/0.35)]" aria-hidden>z</span>
        Zolo
      </Link>
      {visibleItems.map((item) => {
        const isActive = item.href === activeHref;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900",
              isActive && "bg-blue-50 text-[var(--color-primary)] hover:bg-blue-50",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
      <SidebarSupportCard className="mt-auto" />
    </nav>
  );
}
