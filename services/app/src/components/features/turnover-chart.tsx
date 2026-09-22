"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TurnoverItem } from "@/lib/api/types";
import { formatNumberBR } from "@/lib/format";

export function TurnoverChart({ data }: { data: TurnoverItem[] }) {
  const chartData = data.slice(0, 15);

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={60} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumberBR(v, 1)} />
        <Tooltip formatter={(value) => [formatNumberBR(typeof value === "number" ? value : Number(value), 2), "Giro"]} />
        <Bar dataKey="turnoverRate" fill="#2563eb" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
