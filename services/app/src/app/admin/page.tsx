"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, TrendingDown, TrendingUp, Users } from "lucide-react";
import { AdminShell } from "@/components/layout/admin-shell";
import { Card, CardContent } from "@/components/ui/card";
import { PageSpinner } from "@/components/ui/spinner";
import { platformAdminApi } from "@/lib/api/admin";
import { formatCentsToBRL, formatNumberBR, formatPercent } from "@/lib/format";

export default function PlatformMetricsPage() {
  const metricsQuery = useQuery({ queryKey: ["platform-metrics"], queryFn: platformAdminApi.getMetrics });

  return (
    <AdminShell>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Métricas da plataforma</h1>
          <p className="text-sm text-slate-400">Visão consolidada de todos os tenants assinantes</p>
        </div>

        {metricsQuery.isLoading ? (
          <PageSpinner />
        ) : !metricsQuery.data ? (
          <p className="text-sm text-slate-400">Não foi possível carregar as métricas.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard label="MRR" value={formatCentsToBRL(metricsQuery.data.mrrCents)} icon={TrendingUp} />
            <MetricCard label="Tenants ativos" value={formatNumberBR(metricsQuery.data.activeTenantsCount)} icon={Users} />
            <MetricCard label="Tenants inadimplentes" value={formatNumberBR(metricsQuery.data.pastDueTenantsCount)} icon={AlertCircle} tone="danger" />
            <MetricCard label="Churn (30 dias)" value={formatPercent(metricsQuery.data.churnRateLast30d)} icon={TrendingDown} tone="warning" />
            <MetricCard label="Novos tenants (30 dias)" value={formatNumberBR(metricsQuery.data.newTenantsLast30d)} icon={TrendingUp} tone="success" />
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: typeof TrendingUp;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "text-slate-300",
    success: "text-emerald-400",
    warning: "text-amber-400",
    danger: "text-red-400",
  }[tone];

  return (
    <Card className="border-slate-800 bg-slate-900">
      <CardContent className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
        </div>
        <Icon className={`h-8 w-8 ${toneClass}`} aria-hidden />
      </CardContent>
    </Card>
  );
}
