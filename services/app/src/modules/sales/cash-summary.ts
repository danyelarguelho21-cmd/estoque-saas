// Cálculo do fechamento de caixa — funções PURAS (sem banco), testadas em cash-summary.test.ts.
//
//   dinheiro esperado = troco inicial + vendas em dinheiro + suprimentos − sangrias
//   diferença         = contado − esperado   (positivo = sobra, negativo = falta)
//
// Pix e cartões não passam pela gaveta: o esperado de cada um é o total de vendas naquela forma,
// e a diferença só é calculada quando a pessoa informou o valor conferido na maquininha.
import { PAYMENT_METHODS, isPaymentMethod, type PaymentMethod } from "@/lib/payment-methods";

export type SummaryMethodKey = PaymentMethod | "nao_informado";
export const SUMMARY_METHOD_KEYS: readonly SummaryMethodKey[] = [...PAYMENT_METHODS, "nao_informado"];

export interface MethodTotals {
  count: number;
  totalCents: number;
}

export interface CashSummary {
  openingAmountCents: number;
  salesCount: number;
  salesTotalCents: number;
  byMethod: Record<SummaryMethodKey, MethodTotals>;
  suprimentosCents: number;
  sangriasCents: number;
  expectedCashCents: number;
  expectedPixCents: number;
  expectedDebitCents: number;
  expectedCreditCents: number;
}

export interface CountedValues {
  countedCashCents: number | null;
  countedPixCents: number | null;
  countedDebitCents: number | null;
  countedCreditCents: number | null;
}

export interface CashDifferences {
  cash: number | null;
  pix: number | null;
  debit: number | null;
  credit: number | null;
  /** Soma das diferenças que puderam ser calculadas (null se nenhuma). */
  total: number | null;
}

export interface SummarySaleInput {
  paymentMethod: string | null;
  totalAmountCents: number;
}

export interface SummaryMovementInput {
  type: string;
  amountCents: number;
}

function emptyByMethod(): Record<SummaryMethodKey, MethodTotals> {
  const result = {} as Record<SummaryMethodKey, MethodTotals>;
  for (const key of SUMMARY_METHOD_KEYS) result[key] = { count: 0, totalCents: 0 };
  return result;
}

export function computeCashSummary(input: {
  openingAmountCents: number;
  sales: readonly SummarySaleInput[];
  movements: readonly SummaryMovementInput[];
}): CashSummary {
  const byMethod = emptyByMethod();
  let salesTotalCents = 0;
  for (const sale of input.sales) {
    const key: SummaryMethodKey = isPaymentMethod(sale.paymentMethod) ? sale.paymentMethod : "nao_informado";
    byMethod[key].count += 1;
    byMethod[key].totalCents += sale.totalAmountCents;
    salesTotalCents += sale.totalAmountCents;
  }

  let suprimentosCents = 0;
  let sangriasCents = 0;
  for (const movement of input.movements) {
    if (movement.type === "suprimento") suprimentosCents += movement.amountCents;
    else if (movement.type === "sangria") sangriasCents += movement.amountCents;
  }

  return {
    openingAmountCents: input.openingAmountCents,
    salesCount: input.sales.length,
    salesTotalCents,
    byMethod,
    suprimentosCents,
    sangriasCents,
    expectedCashCents: input.openingAmountCents + byMethod.dinheiro.totalCents + suprimentosCents - sangriasCents,
    expectedPixCents: byMethod.pix.totalCents,
    expectedDebitCents: byMethod.cartao_debito.totalCents,
    expectedCreditCents: byMethod.cartao_credito.totalCents,
  };
}

export function computeCashDifferences(summary: CashSummary, counted: CountedValues): CashDifferences {
  const diff = (value: number | null, expected: number) => (value === null ? null : value - expected);
  const cash = diff(counted.countedCashCents, summary.expectedCashCents);
  const pix = diff(counted.countedPixCents, summary.expectedPixCents);
  const debit = diff(counted.countedDebitCents, summary.expectedDebitCents);
  const credit = diff(counted.countedCreditCents, summary.expectedCreditCents);
  const known = [cash, pix, debit, credit].filter((v): v is number => v !== null);
  return { cash, pix, debit, credit, total: known.length ? known.reduce((a, b) => a + b, 0) : null };
}

/** Lê a "fotografia" gravada em cash_sessions.summary (JSON) de volta para o tipo. */
export function parseStoredSummary(value: unknown): CashSummary | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<CashSummary>;
  if (typeof v.expectedCashCents !== "number" || typeof v.salesTotalCents !== "number" || !v.byMethod) return null;
  const byMethod = emptyByMethod();
  for (const key of SUMMARY_METHOD_KEYS) {
    const row = (v.byMethod as Partial<Record<SummaryMethodKey, MethodTotals>>)[key];
    if (row) byMethod[key] = { count: Number(row.count) || 0, totalCents: Number(row.totalCents) || 0 };
  }
  return {
    openingAmountCents: Number(v.openingAmountCents) || 0,
    salesCount: Number(v.salesCount) || 0,
    salesTotalCents: v.salesTotalCents,
    byMethod,
    suprimentosCents: Number(v.suprimentosCents) || 0,
    sangriasCents: Number(v.sangriasCents) || 0,
    expectedCashCents: v.expectedCashCents,
    expectedPixCents: Number(v.expectedPixCents) || 0,
    expectedDebitCents: Number(v.expectedDebitCents) || 0,
    expectedCreditCents: Number(v.expectedCreditCents) || 0,
  };
}
