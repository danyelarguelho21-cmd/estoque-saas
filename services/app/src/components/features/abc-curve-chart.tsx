"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AbcCurveItem } from "@/lib/api/types";
import { formatNumberBR, formatPercent } from "@/lib/format";

const CLASS_COLOR: Record<AbcCurveItem["class"], string> = {
  A: "#2563eb",
  B: "#0891b2",
  C: "#94a3b8",
};

/** Curva ABC — barras por produto (valor) + linha de percentual acumulado (padrão Pareto). */
export function AbcCurveChart({ data }: { data: AbcCurveItem[] }) {
  const chartData = data.slice(0, 20);

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="productName"
          tick={{ fontSize: 11 }}
          angle={-35}
          textAnchor="end"
          interval={0}
          height={60}
        />
        <YAxis yAxisId="value" tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumberBR(v)} />
        <YAxis
          yAxisId="pct"
          orientation="right"
          domain={[0, 100]}
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          formatter={(value, name) => {
            const numeric = typeof value === "number" ? value : Number(value);
            return name === "cumulativePercentage" ? [formatPercent(numeric), "Acumulado"] : [formatNumberBR(numeric), "Valor"];
          }}
        />
        <Bar yAxisId="value" dataKey="value" radius={[4, 4, 0, 0]}>
          {chartData.map((entry) => (
            <Cell key={entry.productId} fill={CLASS_COLOR[entry.class]} />
          ))}
        </Bar>
        <Line yAxisId="pct" type="monotone" dataKey="cumulativePercentage" stroke="#0f172a" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
