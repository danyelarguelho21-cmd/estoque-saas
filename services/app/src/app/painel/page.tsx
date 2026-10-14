"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, DollarSign, PackageX, TrendingUp, Trophy } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { StatCard } from "@/components/features/stat-card";
import { StoreFilter } from "@/components/features/store-filter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { dashboardApi } from "@/lib/api/dashboard";
import { stockApi } from "@/lib/api/stock";
import { AbcCurveChart } from "@/components/features/abc-curve-chart";
import { TurnoverChart } from "@/components/features/turnover-chart";
import { formatCentsToBRL, formatDateBR, formatDateTimeBR, daysUntil } from "@/lib/format";

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfMonth(): string {
  const d = new Date();
  return isoDay(new Date(d.getFullYear(), d.getMonth(), 1));
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}
// Converte o dia (fuso do navegador) em início/fim do dia em ISO para filtrar no servidor.
function dayStartIso(day: string): string {
  return new Date(`${day}T00:00:00`).toISOString();
}
function dayEndIso(day: string): string {
  return new Date(`${day}T23:59:59.999`).toISOString();
}

const ABC_HELP =
  "A Curva ABC mostra quais produtos mais pesam nas suas vendas. A = poucos produtos que trazem cerca de 80% do faturamento (nunca deixe faltar). B = os próximos ~15% (atenção média). C = o restante, cerca de 5% (avalie promoção ou comprar menos). A linha amarela é o percentual acumulado.";
const TURNOVER_HELP =
  "Giro de estoque = quanto vendeu nos últimos 90 dias dividido pelo estoque atual. Giro alto: o produto sai rápido, cuide da reposição. Giro baixo: o produto está parado, cuidado ao comprar mais.";

export default function DashboardPage() {
  const [storeId, setStoreId] = useState<string | undefined>(undefined);
  const [fromDay, setFromDay] = useState(startOfMonth);
  const [toDay, setToDay] = useState(() => isoDay(new Date()));
  const period = {
    from: fromDay ? dayStartIso(fromDay) : undefined,
    to: toDay ? dayEndIso(toDay) : undefined,
  };
  const [abcMetric, setAbcMetric] = useState<"revenue" | "quantity">("revenue");
  const [turnoverGroupBy, setTurnoverGroupBy] = useState<"product" | "category">("product");

  const abcQuery = useQuery({
    queryKey: ["dashboard", "abc-curve", storeId, abcMetric, fromDay, toDay],
    queryFn: () => dashboardApi.getAbcCurve({ storeId, metric: abcMetric, ...period }),
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
    queryKey: ["dashboard", "best-sellers", storeId, fromDay, toDay],
    queryFn: () => dashboardApi.getBestSellers({ storeId, limit: 10, ...period }),
  });
  const revenueQuery = useQuery({
    queryKey: ["dashboard", "revenue", storeId, fromDay, toDay],
    queryFn: () => dashboardApi.getRevenue({ storeId, ...period }),
  });
  const periodLabel =
    fromDay && toDay ? `${fromDay.split("-").reverse().join("/")} a ${toDay.split("-").reverse().join("/")}` : "Todo o período";
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

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="fromDay" className="text-xs font-medium text-[var(--color-muted)]">De</label>
            <Input id="fromDay" type="date" className="w-40" value={fromDay} max={toDay || undefined} onChange={(e) => setFromDay(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="toDay" className="text-xs font-medium text-[var(--color-muted)]">Até</label>
            <Input id="toDay" type="date" className="w-40" value={toDay} min={fromDay || undefined} onChange={(e) => setToDay(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => { setFromDay(isoDay(new Date())); setToDay(isoDay(new Date())); }}>Hoje</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setFromDay(daysAgo(6)); setToDay(isoDay(new Date())); }}>7 dias</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setFromDay(daysAgo(29)); setToDay(isoDay(new Date())); }}>30 dias</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setFromDay(startOfMonth()); setToDay(isoDay(new Date())); }}>Este mês</Button>
          </div>
          <p className="ml-auto text-xs text-[var(--color-muted)]">Vale para faturamento, mais vendidos e curva ABC.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label="Mais vendido"
            value={bestSellersQuery.isLoading ? "…" : (bestSellersQuery.data?.[0]?.productName ?? "—")}
            icon={Trophy}
            tone="success"
            hint={bestSellersQuery.data?.[0] ? `${bestSellersQuery.data[0].quantitySold} un. · ${periodLabel}` : periodLabel}
          />
          <StatCard
            label="Alertas de estoque baixo"
            value={lowStockQuery.isLoading ? "…" : String(lowStockQuery.data?.length ?? 0)}
            icon={PackageX}
            tone={(lowStockQuery.data?.length ?? 0) > 0 ? "danger" : "neutral"}
            hint="Produtos abaixo do mínimo"
          />
          <StatCard
            label="Faturamento"
            value={revenueQuery.isLoading ? "…" : formatCentsToBRL(revenueQuery.data?.revenueCents ?? 0)}
            icon={DollarSign}
            tone="success"
            hint={`${revenueQuery.data?.salesCount ?? 0} venda(s) · ${periodLabel}`}
          />
          <StatCard
            label="Produtos parados"
            value={stalledQuery.isLoading ? "…" : String(stalledQuery.data?.length ?? 0)}
            icon={TrendingUp}
            tone="neutral"
            hint="Sem movimento em 30 dias"
          />
          <StatCard
            label="Lotes vencendo"
            value={expiringQuery.isLoading ? "…" : String(expiringQuery.data?.length ?? 0)}
            icon={AlertTriangle}
            tone={(expiringQuery.data?.length ?? 0) > 0 ? "warning" : "neutral"}
            hint="Dentro da janela configurada"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-1.5">Curva ABC <InfoTip text={ABC_HELP} /></CardTitle>
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
              <CardTitle className="flex items-center gap-1.5">Giro de estoque <InfoTip text={TURNOVER_HELP} /></CardTitle>
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
              <CardTitle>Produtos mais vendidos <span className="font-normal text-[var(--color-muted)]">· {periodLabel}</span></CardTitle>
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
                      <TableCell>{(product as { minStock?: number }).minStock ?? product.minStockGlobal ?? 0}</TableCell>
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
