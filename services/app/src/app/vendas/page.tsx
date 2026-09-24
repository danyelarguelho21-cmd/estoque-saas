"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StoreFilter } from "@/components/features/store-filter";
import { RoleGate } from "@/components/features/role-gate";
import { salesApi } from "@/lib/api/sales";
import { dashboardApi } from "@/lib/api/dashboard";
import { MonthlySalesChart } from "@/components/features/monthly-sales-chart";
import { formatCentsToBRL, formatDateTimeBR } from "@/lib/format";

export default function SalesPage() {
  const [storeId, setStoreId] = useState<string | undefined>(undefined);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);

  const salesQuery = useQuery({
    queryKey: ["sales", storeId, from, to, cursor],
    queryFn: () => salesApi.listSales({ storeId, from: from || undefined, to: to || undefined, cursor, limit: 20 }),
  });
  const monthlySalesQuery = useQuery({
    queryKey: ["monthly-sales", storeId],
    queryFn: () => dashboardApi.getMonthlySales(storeId),
  });

  function goNext() {
    if (!salesQuery.data?.page.next_cursor) return;
    setCursorHistory((h) => [...h, cursor ?? ""]);
    setCursor(salesQuery.data.page.next_cursor);
  }
  function goPrevious() {
    setCursorHistory((h) => {
      const next = [...h];
      const previous = next.pop();
      setCursor(previous || undefined);
      return next;
    });
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Vendas</h1>
            <p className="text-sm text-[var(--color-muted)]">Histórico e faturamento por período e loja</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/vendas/clientes">
                <Users className="h-4 w-4" />
                Clientes
              </Link>
            </Button>
            <RoleGate permission="sales:create">
              <Button asChild>
                <Link href="/vendas/nova">
                  <Plus className="h-4 w-4" />
                  Nova venda
                </Link>
              </Button>
            </RoleGate>
          </div>
        </div>

        <Card className="p-4">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Comparativo de vendas</h2>
          {monthlySalesQuery.data && <MonthlySalesChart data={monthlySalesQuery.data} />}
          {monthlySalesQuery.isLoading && <PageSpinner />}
        </Card>

        <Card>
          <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-border)] p-4">
            <div className="w-full max-w-[200px]">
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="from">De</label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="w-full max-w-[200px]">
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="to">Até</label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="w-full max-w-[220px]">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Loja</span>
              <StoreFilter value={storeId} onChange={setStoreId} />
            </div>
            {salesQuery.data && (
              <div className="ml-auto text-right">
                <p className="text-xs text-[var(--color-muted)]">Total no período</p>
                <p className="text-lg font-semibold text-slate-900">{formatCentsToBRL(salesQuery.data.totalAmountCents)}</p>
              </div>
            )}
          </div>

          {salesQuery.isLoading ? (
            <PageSpinner />
          ) : !salesQuery.data?.items.length ? (
            <EmptyState title="Nenhuma venda encontrada" description="Registre a primeira venda ou ajuste os filtros." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Itens</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesQuery.data.items.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell>{formatDateTimeBR(sale.createdAt)}</TableCell>
                      <TableCell>
                        <Link href={`/vendas/${sale.id}`} className="text-[var(--color-primary)] hover:underline">
                          {sale.items.length} {sale.items.length === 1 ? "item" : "itens"}
                        </Link>
                      </TableCell>
                      <TableCell>{formatCentsToBRL(sale.totalAmountCents)}</TableCell>
                      <TableCell>
                        <Badge variant={sale.status === "completed" ? "success" : "neutral"}>
                          {sale.status === "completed" ? "Concluída" : "Cancelada"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                hasMore={salesQuery.data.page.has_more}
                onNext={goNext}
                onPrevious={goPrevious}
                canGoBack={cursorHistory.length > 0}
                loading={salesQuery.isFetching}
              />
            </>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
