"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { TENANT_NAV_ITEMS } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const { can } = useCurrentUser();

  return (
    <nav aria-label="Navegação principal" className={cn("flex h-full flex-col gap-1 p-4", className)}>
      <Link href="/painel" className="mb-6 flex items-center gap-2 px-2 text-base font-semibold text-slate-900">
        <Boxes className="h-6 w-6 text-[var(--color-primary)]" aria-hidden />
        estoque-saas
      </Link>
      {TENANT_NAV_ITEMS.filter((item) => !item.permission || can(item.permission)).map((item) => {
        const isActive = item.matchPrefix ? pathname.startsWith(item.href) : pathname === item.href;
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
    </nav>
  );
}
