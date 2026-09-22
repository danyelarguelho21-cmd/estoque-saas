"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, LogOut, ShieldCheck, Users2 } from "lucide-react";
import type { ReactNode } from "react";
import { platformAdminApi } from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const ADMIN_NAV = [
  { href: "/admin", label: "Métricas", icon: LayoutDashboard },
  { href: "/admin/tenants", label: "Assinantes", icon: Users2 },
];

/**
 * Shell do painel administrativo interno — sessão TOTALMENTE separada da sessão de tenant
 * (Auth.js). Nunca compartilha componentes de navegação/estado com o AppShell do produto
 * (design-principles.md, zero-trust interno).
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { notify } = useToast();

  async function handleLogout() {
    try {
      await platformAdminApi.logout();
    } catch {
      // mesmo se a chamada falhar, seguimos para o login — a sessão expira no backend
    } finally {
      notify({ title: "Sessão encerrada", variant: "info" });
      router.push("/admin/entrar");
    }
  }

  return (
    <div className="flex min-h-dvh bg-slate-950 text-slate-100">
      <aside className="hidden w-64 shrink-0 border-r border-slate-800 bg-slate-900 lg:flex lg:flex-col">
        <div className="flex items-center gap-2 px-6 py-5 text-base font-semibold">
          <ShieldCheck className="h-6 w-6 text-emerald-400" aria-hidden />
          Painel interno
        </div>
        <nav aria-label="Navegação administrativa" className="flex flex-1 flex-col gap-1 px-4">
          {ADMIN_NAV.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white",
                  isActive && "bg-slate-800 text-white",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-800 p-4">
          <Button variant="ghost" className="w-full justify-start text-slate-300 hover:bg-slate-800 hover:text-white" onClick={handleLogout}>
            <LogOut className="h-4 w-4" aria-hidden />
            Sair
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-4 lg:p-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
