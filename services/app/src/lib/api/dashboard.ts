import { api, buildQuery } from "./client";
import type { AbcCurveItem, BestSeller, MonthlySalesSummary, StalledProduct, TurnoverItem } from "./types";

export const dashboardApi = {
  getMonthlySales: (storeId?: string) =>
    api.get<MonthlySalesSummary[]>(`/api/dashboard/monthly-sales${buildQuery({ storeId })}`),
  getAbcCurve: (
    params: {
      storeId?: string | undefined;
      metric?: "revenue" | "quantity" | undefined;
      from?: string | undefined;
      to?: string | undefined;
    } = {},
  ) => api.get<AbcCurveItem[]>(`/api/dashboard/abc-curve${buildQuery(params)}`),

  getStockTurnover: (params: { storeId?: string | undefined; groupBy?: "product" | "category" | undefined } = {}) =>
    api.get<TurnoverItem[]>(`/api/dashboard/turnover${buildQuery(params)}`),

  getStalledProducts: (params: { storeId?: string | undefined; days?: number | undefined } = {}) =>
    api.get<StalledProduct[]>(`/api/dashboard/stalled-products${buildQuery(params)}`),

  getBestSellers: (
    params: { storeId?: string | undefined; from?: string | undefined; to?: string | undefined; limit?: number | undefined } = {},
  ) => api.get<BestSeller[]>(`/api/dashboard/best-sellers${buildQuery(params)}`),
};
