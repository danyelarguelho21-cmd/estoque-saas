"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageSpinner } from "@/components/ui/spinner";
import { cashApi } from "@/lib/api/cash";
import { tenantsApi } from "@/lib/api/tenants";
import { formatCentsToBRL } from "@/lib/format";

/** Card do Painel: quanto cada loja vendeu hoje, lucro (se puder ver) e se o caixa já foi fechado. */
export function CashTodayCard({ storeId }: { storeId?: string | undefined }) {
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: () => tenantsApi.listStores({ limit: 100 }) });
  const stores = (storesQuery.data?.items ?? []).filter((s) => !storeId || s.id === storeId).slice(0, 6);
  const days = useQueries({
    queries: stores.map((s) => ({ queryKey: ["cash", "day", s.id, "hoje"], queryFn: () => cashApi.day(s.id) })),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Caixa de hoje</CardTitle>
        <Link href="/vendas/caixa" className="text-sm text-[var(--color-primary)] hover:underline">
          Ir para o caixa
        </Link>
      </CardHeader>
      <CardContent>
        {storesQuery.isLoading ? (
          <PageSpinner />
        ) : !stores.length ? (
          <p className="text-sm text-[var(--color-muted)]">Nenhuma loja cadastrada.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stores.map((store, i) => {
              const day = days[i]?.data;
              const closed = Boolean(day?.closing && !day.changedAfterClosing);
              return (
                <Link
                  key={store.id}
                  href={`/vendas/caixa?store=${store.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] p-3 hover:border-[var(--color-primary)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{store.name}</p>
                    <p className="text-lg font-semibold text-slate-900">{day ? formatCentsToBRL(day.salesTotalCents) : "…"}</p>
                    <p className="text-xs text-[var(--color-muted)]">
                      {day ? `${day.salesCount} venda(s)` : ""}
                      {day && day.profitCents !== null ? ` · lucro ${formatCentsToBRL(day.profitCents)}` : ""}
                    </p>
                  </div>
                  {day && (closed ? <Badge variant="success">Fechado</Badge> : <Badge variant="warning">Aberto</Badge>)}
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
