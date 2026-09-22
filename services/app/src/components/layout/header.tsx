"use client";

import { signOut } from "next-auth/react";
import { LogOut, Menu, User as UserIcon } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ROLE_LABELS } from "@/lib/rbac";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Header({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { user, role, tenantName } = useCurrentUser();

  return (
    <header className="flex h-16 items-center justify-between border-b border-[var(--color-border)] bg-white px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenMobileNav}
          aria-label="Abrir menu de navegação"
        >
          <Menu className="h-5 w-5" />
        </Button>
        {tenantName && <p className="hidden text-sm font-medium text-slate-500 sm:block">{tenantName}</p>}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            aria-label="Menu do usuário"
          >
            <Avatar name={user?.name ?? user?.email ?? "Usuário"} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>
            {user?.name ?? user?.email}
            {role && <span className="block font-normal text-slate-400">{ROLE_LABELS[role]}</span>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled className="opacity-60">
            <UserIcon className="h-4 w-4" aria-hidden />
            Meu perfil (em breve)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/entrar" })}>
            <LogOut className="h-4 w-4" aria-hidden />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
