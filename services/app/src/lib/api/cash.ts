import { api, buildQuery } from "./client";
import type { SummaryMethodKeyClient } from "./cash-types";
export type { SummaryMethodKeyClient } from "./cash-types";

export interface CashMovement {
  id: string;
  type: "sangria" | "suprimento";
  amountCents: number;
  reason: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

export interface CashSummary {
  openingAmountCents: number;
  salesCount: number;
  salesTotalCents: number;
  byMethod: Record<SummaryMethodKeyClient, { count: number; totalCents: number }>;
  suprimentosCents: number;
  sangriasCents: number;
  expectedCashCents: number;
  expectedPixCents: number;
  expectedDebitCents: number;
  expectedCreditCents: number;
}

export interface CashDifferences {
  cash: number | null;
  pix: number | null;
  debit: number | null;
  credit: number | null;
  total: number | null;
}

export interface CashSale {
  id: string;
  createdAt: string;
  totalAmountCents: number;
  paymentMethod: string | null;
  paymentMethodLabel: string | null;
  sellerId: string;
  sellerName: string | null;
}

export interface CashSession {
  id: string;
  storeId: string;
  storeName: string;
  status: "open" | "closed";
  openingAmountCents: number;
  openedBy: string;
  openedByName: string | null;
  openedAt: string;
  closedBy: string | null;
  closedByName: string | null;
  closedAt: string | null;
  countedCashCents: number | null;
  countedPixCents: number | null;
  countedDebitCents: number | null;
  countedCreditCents: number | null;
  notes: string | null;
  movements: CashMovement[];
  financial: boolean;
  summary?: CashSummary;
  differences?: CashDifferences | null;
  sales?: CashSale[];
}

export interface OpenCashSessionItem {
  id: string;
  storeId: string;
  storeName: string;
  openingAmountCents: number;
  openedByName: string | null;
  openedAt: string;
  movementCount: number;
}

export interface ClosedCashSessionItem {
  id: string;
  storeId: string;
  storeName: string;
  openedAt: string;
  openedByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
  salesCount: number;
  salesTotalCents: number;
  expectedCashCents: number | null;
  countedCashCents: number | null;
  cashDifferenceCents: number | null;
  totalDifferenceCents: number | null;
}

export interface TodayCashStatus {
  storeId: string;
  storeName: string;
  status: "open" | "closed" | "none";
  sessionId: string | null;
  openedAt: string | null;
  closedAt: string | null;
  cashDifferenceCents: number | null;
  totalDifferenceCents: number | null;
}

export const cashApi = {
  listOpen: (storeId?: string) => api.get<OpenCashSessionItem[]>(`/api/cash-sessions${buildQuery({ storeId })}`),
  open: (storeId: string, openingAmountCents: number) =>
    api.post<CashSession>("/api/cash-sessions", { storeId, openingAmountCents }),
  get: (sessionId: string) => api.get<CashSession>(`/api/cash-sessions/${sessionId}`),
  addMovement: (sessionId: string, input: { type: "sangria" | "suprimento"; amountCents: number; reason: string }) =>
    api.post<CashMovement>(`/api/cash-sessions/${sessionId}/movements`, input),
  close: (
    sessionId: string,
    input: { countedCashCents: number; countedPixCents?: number; countedDebitCents?: number; countedCreditCents?: number; notes?: string },
  ) => api.post<CashSession>(`/api/cash-sessions/${sessionId}/close`, input),
  history: (params: { storeId?: string | undefined; from?: string | undefined; to?: string | undefined; cursor?: string | undefined; limit?: number } = {}) =>
    api.get<{ items: ClosedCashSessionItem[]; page: { next_cursor: string | null; has_more: boolean } }>(
      `/api/cash-sessions/history${buildQuery(params)}`,
    ),
  today: (storeId?: string) => api.get<TodayCashStatus[]>(`/api/cash-sessions/today${buildQuery({ storeId })}`),
};

/** "150,50" / "150.50" / "1.234,56" -> centavos. Vazio ou inválido -> null. */
export function parseMoneyToCents(value: string): number | null {
  const raw = value.trim().replace(/\s|R\$/g, "");
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}
