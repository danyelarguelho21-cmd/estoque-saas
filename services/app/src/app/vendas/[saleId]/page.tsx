"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageSpinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { salesApi } from "@/lib/api/sales";
import { formatCentsToBRL, formatDateTimeBR } from "@/lib/format";

export default function SaleDetailPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = use(params);
  const saleQuery = useQuery({ queryKey: ["sale", saleId], queryFn: () => salesApi.getSale(saleId) });

  if (saleQuery.isLoading) {
    return (
      <AppShell>
        <PageSpinner />
      </AppShell>
    );
  }

  if (!saleQuery.data) {
    return (
      <AppShell>
        <EmptyState title="Venda não encontrada" />
      </AppShell>
    );
  }

  const sale = saleQuery.data;

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Venda</h1>
            <p className="text-sm text-[var(--color-muted)]">{formatDateTimeBR(sale.createdAt)}</p>
          </div>
          <Badge variant={sale.status === "completed" ? "success" : "neutral"}>
            {sale.status === "completed" ? "Concluída" : "Cancelada"}
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Itens</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Qtd.</TableHead>
                <TableHead>Preço unit.</TableHead>
                <TableHead>Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sale.items.map((item, index) => (
                <TableRow key={`${item.productId}-${index}`}>
                  <TableCell>
                    <Link href={`/produtos/${item.productId}`} className="text-[var(--color-primary)] hover:underline">
                      Ver produto
                    </Link>
                  </TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{formatCentsToBRL(item.unitPriceCents)}</TableCell>
                  <TableCell>{formatCentsToBRL(item.unitPriceCents * item.quantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <CardContent className="flex items-center justify-between border-t border-[var(--color-border)]">
            <p className="text-sm text-[var(--color-muted)]">Total</p>
            <p className="text-xl font-semibold text-slate-900">{formatCentsToBRL(sale.totalAmountCents)}</p>
          </CardContent>
        </Card>

        {sale.customerId && (
          <Button asChild variant="outline">
            <Link href={`/vendas/clientes/${sale.customerId}`}>Ver histórico do cliente</Link>
          </Button>
        )}
      </div>
    </AppShell>
  );
}
