import { api, buildQuery } from "./client";
import type {
  Batch,
  FefoSuggestion,
  ManualEntryInput,
  NfeConfirmItemInput,
  NfeImport,
  Paginated,
  Product,
  StockExitInput,
  StockMovement,
  StockMovementType,
  TransferInput,
} from "./types";

export const stockApi = {
  listMovements: (
    params: {
      cursor?: string | undefined;
      limit?: number | undefined;
      storeId?: string | undefined;
      productId?: string | undefined;
      type?: StockMovementType | undefined;
    } = {},
  ) => api.get<Paginated<StockMovement>>(`/api/stock/movements${buildQuery(params)}`),

  createManualEntry: (input: ManualEntryInput) => api.post<StockMovement>("/api/stock/entries", input),
  createExit: (input: StockExitInput) => api.post<StockMovement>("/api/stock/exits", input),

  getFefoSuggestion: (productId: string, storeId: string, quantity: number) =>
    api.get<FefoSuggestion>(`/api/stock/fefo-suggestion${buildQuery({ productId, storeId, quantity })}`),

  createTransfer: (input: TransferInput) => api.post<void>("/api/transfers", input),

  uploadNfeImport: (file: File, storeId: string) => {
    const form = new FormData();
    form.set("file", file);
    form.set("storeId", storeId);
    return api.post<{ importId: string }>("/api/nfe-imports", form);
  },
  getNfeImport: (importId: string) => api.get<NfeImport>(`/api/nfe-imports/${importId}`),
  confirmNfeImport: (importId: string, items: NfeConfirmItemInput[]) =>
    api.post<void>(`/api/nfe-imports/${importId}/confirm`, { items }),

  listLowStockAlerts: (storeId?: string | undefined) =>
    api.get<Product[]>(`/api/alerts/low-stock${buildQuery({ storeId })}`),
  listExpiringBatches: (storeId?: string | undefined) =>
    api.get<Batch[]>(`/api/alerts/expiring-batches${buildQuery({ storeId })}`),
};
