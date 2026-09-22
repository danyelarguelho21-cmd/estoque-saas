import { api, buildQuery } from "./client";
import type { Invoice, Paginated, Plan, Subscription } from "./types";

export const billingApi = {
  listPlans: () => api.get<Plan[]>("/api/plans"),
  getSubscription: () => api.get<Subscription>("/api/billing/subscription"),
  createSubscription: (input: { planId: string; paymentMethod: "card" | "pix_boleto"; cardToken?: string | undefined }) =>
    api.post<Subscription>("/api/billing/subscription", input),
  changePlan: (planId: string) => api.patch<void>("/api/billing/subscription/plan", { planId }),
  listInvoices: (params: { cursor?: string | undefined; limit?: number | undefined } = {}) =>
    api.get<Paginated<Invoice>>(`/api/billing/invoices${buildQuery(params)}`),
};
