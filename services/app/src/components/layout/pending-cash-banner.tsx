"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { cashApi, formatCashDate } from "@/lib/api/cash";
import { useCurrentUser } from "@/hooks/use-current-user";

/** Aviso em todas as telas: "você não fechou o caixa de ontem" (some na própria tela do caixa). */
export function PendingCashBanner() {
  const { can } = useCurrentUser();
  const pathname = usePathname();
  const canUseCash = can("sales:create");
  const pendingQuery = useQuery({
    queryKey: ["cash", "pending"],
    queryFn: () => cashApi.pending(),
    enabled: canUseCash,
    staleTime: 60_000,
  });
  const pending = pendingQuery.data ?? [];
  const first = pending[0];
  if (!canUseCash || !first || pathname?.startsWith("/vendas/caixa")) return null;

  const href = `/vendas/caixa?store=${first.storeId}&date=${first.date}`;
  const message =
    pending.length === 1
      ? `Você não fechou o caixa de ${formatCashDate(first.date)}${first.storeName ? ` (${first.storeName})` : ""}.`
      : `Você tem ${pending.length} caixas sem fechar, desde ${formatCashDate(first.date)}.`;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-amber-900">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <b>{message}</b>
      </span>
      <Link
        href={href}
        className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-primary-foreground)] hover:opacity-90"
      >
        Fechar agora
      </Link>
    </div>
  );
}
