import { api, buildQuery } from "./client";
import type { Customer, CustomerInput, Paginated, Sale, SaleInput } from "./types";

export const salesApi = {
  listSales: (
    params: {
      cursor?: string | undefined;
      limit?: number | undefined;
      storeId?: string | undefined;
      from?: string | undefined;
      to?: string | undefined;
    } = {},
  ) => api.get<Paginated<Sale> & { totalAmountCents: number }>(`/api/sales${buildQuery(params)}`),
  createSale: (input: SaleInput) => api.post<Sale>("/api/sales", input),
  getSale: (saleId: string) => api.get<Sale>(`/api/sales/${saleId}`),

  listCustomers: (params: { cursor?: string | undefined; limit?: number | undefined; search?: string | undefined } = {}) =>
    api.get<Paginated<Customer>>(`/api/customers${buildQuery(params)}`),
  createCustomer: (input: CustomerInput) => api.post<Customer>("/api/customers", input),
  getCustomerHistory: (customerId: string) => api.get<Sale[]>(`/api/customers/${customerId}/history`),
};
