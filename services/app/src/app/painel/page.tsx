"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, PackageX, TrendingUp, Trophy } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { StatCard } from "@/components/features/stat-card";
import { StoreFilter } from "@/components/features/store-filter";
import { dashboardApi } from "@/lib/api/dashboard";
import { stockApi } from "@/lib/api/stock";
import { AbcCurveChart } from "@/components/features/abc-curve-chart";
import { TurnoverChart } from "@/components/features/turnover-chart";
import { formatCentsToBRL, formatDateBR, formatDateTimeBR, daysUntil } from "@/lib/format";

export default function DashboardPage() {
  const [storeId, setStoreId] = useState<string | undefined>(undefined);
  const [abcMetric, setAbcMetric] = useState<"revenue" | "quantity">("revenue");
  const [turnoverGroupBy, setTurnoverGroupBy] = useState<"product" | "category">("product");

  const abcQuery = useQuery({
    queryKey: ["dashboard", "abc-curve", storeId, abcMetric],
    queryFn: () => dashboardApi.getAbcCurve({ storeId, metric: abcMetric }),
  });
  const turnoverQuery = useQuery({
    queryKey: ["dashboard", "turnover", storeId, turnoverGroupBy],
    queryFn: () => dashboardApi.getStockTurnover({ storeId, groupBy: turnoverGroupBy }),
  });
  const stalledQuery = useQuery({
    queryKey: ["dashboard", "stalled", storeId],
    queryFn: () => dashboardApi.getStalledProducts({ storeId, days: 30 }),
  });
  const bestSellersQuery = useQuery({
    queryKey: ["dashboard", "best-sellers", storeId],
    queryFn: () => dashboardApi.getBestSellers({ storeId, limit: 10 }),
  });
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
            <h1 className="text-xl font-semibold text-slate-900">Painel</h1>
            <p className="text-sm text-[var(--color-muted)]">Visão geral de estoque e vendas</p>
          </div>
          <div className="w-full max-w-[220px]">
            <StoreFilter value={storeId} onChange={setStoreId} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Alertas de estoque baixo"
            value={lowStockQuery.isLoading ? "…" : String(lowStockQuery.data?.length ?? 0)}
            icon={PackageX}
            tone={(lowStockQuery.data?.length ?? 0) > 0 ? "danger" : "neutral"}
            hint="Produtos abaixo do mínimo"
          />
          <StatCard
            label="Lotes vencendo"
            value={expiringQuery.isLoading ? "…" : String(expiringQuery.data?.length ?? 0)}
            icon={AlertTriangle}
            tone={(expiringQuery.data?.length ?? 0) > 0 ? "warning" : "neutral"}
            hint="Dentro da janela configurada"
          />
          <StatCard
            label="Produtos parados"
            value={stalledQuery.isLoading ? "…" : String(stalledQuery.data?.length ?? 0)}
            icon={TrendingUp}
            tone="neutral"
            hint="Sem movimento em 30 dias"
          />
          <StatCard
            label="Mais vendido"
            value={bestSellersQuery.data?.[0]?.productName ?? "—"}
            icon={Trophy}
            tone="success"
            hint={bestSellersQuery.data?.[0] ? `${bestSellersQuery.data[0].quantitySold} un.` : undefined}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Curva ABC</CardTitle>
              <Tabs value={abcMetric} onValueChange={(v) => setAbcMetric(v as "revenue" | "quantity")}>
                <TabsList>
                  <TabsTrigger value="revenue">Faturamento</TabsTrigger>
                  <TabsTrigger value="quantity">Quantidade</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              {abcQuery.isLoading ? (
                <PageSpinner />
              ) : !abcQuery.data?.length ? (
                <EmptyState title="Sem dados suficientes" description="Registre vendas para ver a curva ABC." />
              ) : (
                <AbcCurveChart data={abcQuery.data} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Giro de estoque</CardTitle>
              <Tabs value={turnoverGroupBy} onValueChange={(v) => setTurnoverGroupBy(v as "product" | "category")}>
                <TabsList>
                  <TabsTrigger value="product">Produto</TabsTrigger>
                  <TabsTrigger value="category">Categoria</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              {turnoverQuery.isLoading ? (
                <PageSpinner />
              ) : !turnoverQuery.data?.length ? (
                <EmptyState title="Sem dados suficientes" description="Registre movimentações para calcular o giro." />
              ) : (
                <TurnoverChart data={turnoverQuery.data} />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Produtos mais vendidos</CardTitle>
            </CardHeader>
            {bestSellersQuery.isLoading ? (
              <PageSpinner />
            ) : !bestSellersQuery.data?.length ? (
              <CardContent>
                <EmptyState title="Nenhuma venda no período" />
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Qtd.</TableHead>
                    <TableHead>Receita</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bestSellersQuery.data.map((item) => (
                    <TableRow key={item.productId}>
                      <TableCell>{item.productName}</TableCell>
                      <TableCell>{item.quantitySold}</TableCell>
                      <TableCell>{formatCentsToBRL(item.revenueCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Produtos parados (30 dias)</CardTitle>
            </CardHeader>
            {stalledQuery.isLoading ? (
              <PageSpinner />
            ) : !stalledQuery.data?.length ? (
              <CardContent>
                <EmptyState title="Nenhum produto parado" description="Todos os produtos tiveram movimento recente." />
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Última movimentação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stalledQuery.data.map((item) => (
                    <TableRow key={item.productId}>
                      <TableCell>{item.productName}</TableCell>
                      <TableCell>{formatDateTimeBR(item.lastMovementAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Alertas de estoque baixo</CardTitle>
            </CardHeader>
            {lowStockQuery.isLoading ? (
              <PageSpinner />
            ) : !lowStockQuery.data?.length ? (
              <CardContent>
                <EmptyState title="Nenhum alerta" description="Todos os produtos estão acima do estoque mínimo." />
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Saldo atual</TableHead>
                    <TableHead>Mínimo</TableHead>
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
                <EmptyState title="Nenhum lote vencendo" description="Sem lotes dentro da janela de alerta configurada." />
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
                  {expiringQuery.data.map((batch) => {
                    const days = daysUntil(batch.expiryDate);
                    return (
                      <TableRow key={batch.id}>
                        <TableCell>{batch.batchNumber}</TableCell>
                        <TableCell>
                          <Badge variant={days <= 7 ? "danger" : days <= 15 ? "warning" : "info"}>
                            {formatDateBR(batch.expiryDate)} ({days >= 0 ? `${days}d` : "vencido"})
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
      </div>
    </AppShell>
  );
}
