"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthlySalesSummary } from "@/lib/api/types";
import { formatCentsToBRL, formatNumberBR } from "@/lib/format";

export function MonthlySalesChart({ data }: { data: MonthlySalesSummary[] }) {
  const chartData = data.map((item) => {
    const [year, month] = item.month.split("-").map(Number);
    const label = new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(year ?? 2000, (month ?? 1) - 1, 1));
    return { ...item, label: `${label}/${String(year).slice(-2)}` };
  });
  const current = chartData.at(-1);
  const previous = chartData.at(-2);
  const change = previous && previous.revenueCents > 0
    ? ((current!.revenueCents - previous.revenueCents) / previous.revenueCents) * 100
    : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap justify-between gap-2 text-sm">
        <span className="text-slate-600">Últimos 6 meses · faturamento</span>
        {change !== null && <span className={change >= 0 ? "font-medium text-emerald-700" : "font-medium text-rose-700"}>
          {change >= 0 ? "+" : ""}{formatNumberBR(change, 1)}% vs. mês anterior
        </span>}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(value: number) => `R$${formatNumberBR(value / 100, 0)}`} width={58} />
          <Tooltip formatter={(value) => [formatCentsToBRL(Number(value)), "Faturamento"]} />
          <Bar dataKey="revenueCents" name="Faturamento" fill="#2563eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-[var(--color-muted)]">Quantidade de vendas: {chartData.map((item) => `${item.label}: ${item.salesCount}`).join(" · ")}</p>
    </div>
  );
}
