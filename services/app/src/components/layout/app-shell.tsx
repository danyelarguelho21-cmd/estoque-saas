"use client";

import { useState, type ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

/** Shell autenticado do produto (tenant): sidebar fixa em desktop, drawer em mobile. */
export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-[var(--color-background)]">
      <aside className="hidden w-64 shrink-0 border-r border-[var(--color-border)] bg-white lg:block">
        <Sidebar />
      </aside>

      <RadixDialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" />
          <RadixDialog.Content className="fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-xl lg:hidden">
            <RadixDialog.Title className="sr-only">Menu de navegação</RadixDialog.Title>
            <Sidebar />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
