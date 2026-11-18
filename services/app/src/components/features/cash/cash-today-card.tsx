"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageSpinner } from "@/components/ui/spinner";
import { cashApi } from "@/lib/api/cash";
import { tenantsApi } from "@/lib/api/tenants";
import { formatCentsToBRL } from "@/lib/format";

/** Card do Painel: vendido, custo e lucro de hoje (todas as lojas) + situação do caixa de cada loja. */
export function CashTodayCard({ storeId }: { storeId?: string | undefined }) {
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: () => tenantsApi.listStores({ limit: 100 }) });
  const stores = (storesQuery.data?.items ?? []).filter((s) => !storeId || s.id === storeId).slice(0, 20);
  const days = useQueries({
    queries: stores.map((s) => ({ queryKey: ["cash", "day", s.id, "hoje"], queryFn: () => cashApi.day(s.id) })),
  });

  const loaded = days.map((d) => d.data).filter((d): d is NonNullable<typeof d> => Boolean(d));
  const allLoaded = stores.length > 0 && loaded.length === stores.length;
  const totals = loaded.reduce(
    (acc, d) => ({
      sales: acc.sales + d.salesTotalCents,
      count: acc.count + d.salesCount,
      cost: acc.cost + (d.costTotalCents ?? 0),
      profit: acc.profit + (d.profitCents ?? 0),
    }),
    { sales: 0, count: 0, cost: 0, profit: 0 },
  );
  const showProfit = loaded.some((d) => d.profitCents !== null);

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
          <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TodayNumber label="Vendido hoje" value={allLoaded ? formatCentsToBRL(totals.sales) : "…"} hint={allLoaded ? `${totals.count} venda(s)` : ""} />
            {showProfit && (
              <>
                <TodayNumber label="Custo dos produtos" value={allLoaded ? formatCentsToBRL(totals.cost) : "…"} hint="Pelo preço de custo cadastrado" />
                <TodayNumber
                  label="Lucro de hoje"
                  value={allLoaded ? formatCentsToBRL(totals.profit) : "…"}
                  hint="Vendido − custo"
                  tone={totals.profit < 0 ? "danger" : "success"}
                />
              </>
            )}
          </div>
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TodayNumber({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "success" | "danger" }) {
  const color = tone === "danger" ? "text-red-600" : tone === "success" ? "text-emerald-600" : "text-slate-900";
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
      {hint && <p className="text-xs text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}
