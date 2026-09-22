"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { StoreFilter } from "@/components/features/store-filter";
import { stockApi } from "@/lib/api/stock";
import { formatDateBR, daysUntil } from "@/lib/format";

export default function StockAlertsPage() {
  const [storeId, setStoreId] = useState<string | undefined>(undefined);

  const lowStockQuery = useQuery({
    queryKey: ["alerts", "low-stock", storeId],
    queryFn: () => stockApi.listLowStockAlerts(storeId),
  });
  const expiringQuery = useQuery({
    queryKey: ["alerts", "expiring-batches", storeId],
    queryFn: () => stockApi.listExpiringBatches(storeId),
  });

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Alertas de estoque</h1>
            <p className="text-sm text-[var(--color-muted)]">Estoque baixo e lotes vencendo (janela configurada por empresa)</p>
          </div>
          <div className="w-full max-w-[220px]">
            <StoreFilter value={storeId} onChange={setStoreId} />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Estoque baixo</CardTitle>
          </CardHeader>
          {lowStockQuery.isLoading ? (
            <PageSpinner />
          ) : !lowStockQuery.data?.length ? (
            <CardContent>
              <EmptyState title="Nenhum alerta de estoque baixo" description="Todos os produtos estão acima do mínimo configurado." />
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Saldo atual</TableHead>
                  <TableHead>Mínimo configurado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStockQuery.data.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <Link href={`/produtos/${product.id}`} className="text-[var(--color-primary)] hover:underline">
                        {product.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{product.sku}</TableCell>
                    <TableCell>
                      <Badge variant="danger">{product.currentStock ?? 0}</Badge>
                    </TableCell>
                    <TableCell>{product.minStockGlobal ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lotes vencendo</CardTitle>
          </CardHeader>
          {expiringQuery.isLoading ? (
            <PageSpinner />
          ) : !expiringQuery.data?.length ? (
            <CardContent>
              <EmptyState title="Nenhum lote vencendo" description="Nenhum lote dentro da janela de alerta configurada (padrão: 30/15/7 dias)." />
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lote</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiringQuery.data
                  .slice()
                  .sort((a, b) => daysUntil(a.expiryDate) - daysUntil(b.expiryDate))
                  .map((batch) => {
                    const days = daysUntil(batch.expiryDate);
                    return (
                      <TableRow key={batch.id}>
                        <TableCell>{batch.batchNumber}</TableCell>
                        <TableCell>
                          <Badge variant={days <= 7 ? "danger" : days <= 15 ? "warning" : "info"}>
                            {formatDateBR(batch.expiryDate)} ({days >= 0 ? `${days} dias` : "vencido"})
                          </Badge>
                        </TableCell>
                        <TableCell>{batch.quantity}</TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
