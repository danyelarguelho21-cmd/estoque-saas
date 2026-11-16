import { api, buildQuery } from "./client";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/payment-methods";

export type CashMethodKey = PaymentMethod | "nao_informado";
export type CashByMethod = Record<CashMethodKey, number>;

/** Ordem e rótulos das formas de pagamento nas telas de caixa. */
export const CASH_METHODS: { key: CashMethodKey; label: string }[] = [
  ...PAYMENT_METHODS.map((key) => ({ key, label: PAYMENT_METHOD_LABELS[key] })),
  { key: "nao_informado", label: "Não informado" },
];

export interface DayCashSale {
  id: string;
  createdAt: string;
  totalAmountCents: number;
  paymentMethod: CashMethodKey;
  sellerName: string | null;
}

export interface DayCash {
  storeId: string;
  storeName: string;
  date: string;
  isToday: boolean;
  salesCount: number;
  salesTotalCents: number;
  byMethod: CashByMethod;
  /** null = sem acesso financeiro (vendedor sem a senha do gestor). */
  costTotalCents: number | null;
  profitCents: number | null;
  sales: DayCashSale[];
  closing: {
    closedAt: string;
    closedByName: string | null;
    notes: string | null;
    salesCount: number;
    salesTotalCents: number;
  } | null;
  changedAfterClosing: boolean;
}

export interface PendingCashDay {
  storeId: string;
  storeName: string;
  date: string;
  salesCount: number;
  salesTotalCents: number;
  changedAfterClosing: boolean;
}

export interface CashClosingItem {
  id: string;
  storeId: string;
  storeName: string;
  date: string;
  salesCount: number;
  salesTotalCents: number;
  byMethod: CashByMethod;
  costTotalCents: number | null;
  profitCents: number | null;
  closedAt: string;
  closedByName: string | null;
  notes: string | null;
}

export const cashApi = {
  day: (storeId: string, date?: string) => api.get<DayCash>(`/api/cash/day${buildQuery({ storeId, date })}`),
  close: (input: { storeId: string; date: string; notes?: string }) => api.post<DayCash>("/api/cash/day/close", input),
  pending: (storeId?: string) => api.get<PendingCashDay[]>(`/api/cash/pending${buildQuery({ storeId })}`),
  closings: (params: { storeId?: string | undefined; limit?: number } = {}) =>
    api.get<CashClosingItem[]>(`/api/cash/closings${buildQuery(params)}`),
};

/** "2026-11-15" -> "15/11/2026" (sem passar por Date, para não trocar o dia por causa do fuso). */
export function formatCashDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}
