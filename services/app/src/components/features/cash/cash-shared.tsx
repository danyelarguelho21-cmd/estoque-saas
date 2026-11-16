"use client";

import { Badge } from "@/components/ui/badge";
import { formatCentsToBRL } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-methods";
import type { CashDifferences, CashSession, CashSummary } from "@/lib/api/cash";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Diferença de caixa: 0 = confere, positivo = sobra, negativo = falta. */
export function DifferenceBadge({ cents }: { cents: number | null | undefined }) {
  if (cents === null || cents === undefined) return <span className="text-[var(--color-muted)]">—</span>;
  if (cents === 0) return <Badge variant="success">Confere</Badge>;
  if (cents > 0) return <Badge variant="warning">Sobra {formatCentsToBRL(cents)}</Badge>;
  return <Badge variant="danger">Falta {formatCentsToBRL(Math.abs(cents))}</Badge>;
}

const ROWS: { key: "cash" | "pix" | "debit" | "credit"; label: string; expected: keyof CashSummary; counted: keyof CashSession }[] = [
  { key: "cash", label: "Dinheiro (gaveta)", expected: "expectedCashCents", counted: "countedCashCents" },
  { key: "pix", label: PAYMENT_METHOD_LABELS.pix, expected: "expectedPixCents", counted: "countedPixCents" },
  { key: "debit", label: PAYMENT_METHOD_LABELS.cartao_debito, expected: "expectedDebitCents", counted: "countedDebitCents" },
  { key: "credit", label: PAYMENT_METHOD_LABELS.cartao_credito, expected: "expectedCreditCents", counted: "countedCreditCents" },
];

/** Tabela "esperado × contado × diferença" por forma de pagamento (só para quem tem acesso financeiro). */
export function ConferenceTable({ session, summary, differences }: { session: CashSession; summary: CashSummary; differences: CashDifferences | null | undefined }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Forma</TableHead>
          <TableHead>Esperado</TableHead>
          <TableHead>Contado</TableHead>
          <TableHead>Diferença</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => {
          const counted = session[row.counted] as number | null;
          return (
            <TableRow key={row.key}>
              <TableCell className="font-medium text-slate-900">{row.label}</TableCell>
              <TableCell>{formatCentsToBRL(summary[row.expected] as number)}</TableCell>
              <TableCell>{counted === null ? <span className="text-[var(--color-muted)]">não conferido</span> : formatCentsToBRL(counted)}</TableCell>
              <TableCell>
                <DifferenceBadge cents={differences?.[row.key]} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Resumo de vendas por forma de pagamento + movimentação de dinheiro. */
export function SummaryGrid({ summary }: { summary: CashSummary }) {
  const items: { label: string; value: string; hint?: string }[] = [
    { label: "Vendas no caixa", value: formatCentsToBRL(summary.salesTotalCents), hint: `${summary.salesCount} venda(s)` },
    { label: "Dinheiro", value: formatCentsToBRL(summary.byMethod.dinheiro.totalCents), hint: `${summary.byMethod.dinheiro.count} venda(s)` },
    { label: "Pix", value: formatCentsToBRL(summary.byMethod.pix.totalCents), hint: `${summary.byMethod.pix.count} venda(s)` },
    { label: "Débito", value: formatCentsToBRL(summary.byMethod.cartao_debito.totalCents), hint: `${summary.byMethod.cartao_debito.count} venda(s)` },
    { label: "Crédito", value: formatCentsToBRL(summary.byMethod.cartao_credito.totalCents), hint: `${summary.byMethod.cartao_credito.count} venda(s)` },
    {
      label: "Outros / não informado",
      value: formatCentsToBRL(summary.byMethod.outro.totalCents + summary.byMethod.nao_informado.totalCents),
      hint: `${summary.byMethod.outro.count + summary.byMethod.nao_informado.count} venda(s)`,
    },
    { label: "Troco inicial", value: formatCentsToBRL(summary.openingAmountCents) },
    { label: "Suprimentos", value: `+ ${formatCentsToBRL(summary.suprimentosCents)}` },
    { label: "Sangrias", value: `− ${formatCentsToBRL(summary.sangriasCents)}` },
    { label: "Dinheiro esperado na gaveta", value: formatCentsToBRL(summary.expectedCashCents), hint: "troco + vendas em dinheiro + suprimentos − sangrias" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] p-3">
          <p className="text-xs text-[var(--color-muted)]">{item.label}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{item.value}</p>
          {item.hint && <p className="text-xs text-[var(--color-muted)]">{item.hint}</p>}
        </div>
      ))}
    </div>
  );
}
