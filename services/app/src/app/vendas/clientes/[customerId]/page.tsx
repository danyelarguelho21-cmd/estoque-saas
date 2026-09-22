"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { salesApi } from "@/lib/api/sales";
import { formatCentsToBRL, formatDateTimeBR } from "@/lib/format";

export default function CustomerHistoryPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = use(params);
  const historyQuery = useQuery({
    queryKey: ["customer-history", customerId],
    queryFn: () => salesApi.getCustomerHistory(customerId),
  });

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Histórico de compras</h1>
          <p className="text-sm text-[var(--color-muted)]">Todas as vendas registradas para este cliente</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Compras</CardTitle>
          </CardHeader>
          {historyQuery.isLoading ? (
            <PageSpinner />
          ) : !historyQuery.data?.length ? (
            <EmptyState title="Nenhuma compra registrada" description="Esse cliente ainda não realizou nenhuma venda." />
          ) : (
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
                {historyQuery.data.map((sale) => (
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
          )}
        </Card>
      </div>
    </AppShell>
  );
}
