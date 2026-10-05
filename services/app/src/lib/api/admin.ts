import { api, buildQuery } from "./client";
import type { Paginated, PlatformMetrics, SubscriptionStatus, TenantAdminSummary } from "./types";

export type AdminCreateTenantInput = {
  companyName: string;
  adminName: string;
  adminEmail: string;
  password: string;
  planId: string;
  access: { type: "courtesy" } | { type: "trial"; days: number } | { type: "pending" };
} & ({ personType: "PJ"; cnpj: string } | { personType: "PF"; cpf: string });

/**
 * Rotas `/api/platform-admin/*` — sessão de plataforma separada (`__Host-platform-session`),
 * nunca reaproveita a sessão de tenant (Auth.js). Ver design-principles.md, zero-trust interno.
 */
export const platformAdminApi = {
  login: (email: string, password: string) =>
    api.post<void>("/api/platform-admin/login", { email, password }),
  /**
   * GAP DE CONTRATO: api/openapi/admin.yaml não define um endpoint de logout (apenas login,
   * listTenants, suspend, reactivate, metrics). Endpoint assumido por convenção simétrica ao
   * `/api/auth/logout` de auth.yaml — a implementar pelo Software Engineer; documentado aqui e
   * em 01-analysis.md em vez de silenciosamente inventado.
   */
  logout: () => api.post<void>("/api/platform-admin/logout"),

  listTenants: (
    params: { cursor?: string | undefined; limit?: number | undefined; subscriptionStatus?: SubscriptionStatus | undefined } = {},
  ) =>
    api.get<Paginated<TenantAdminSummary>>(`/api/platform-admin/tenants${buildQuery(params)}`),

  suspendTenant: (tenantId: string) => api.post<void>(`/api/platform-admin/tenants/${tenantId}/suspend`),
  reactivateTenant: (tenantId: string) => api.post<void>(`/api/platform-admin/tenants/${tenantId}/reactivate`),
  grantTrial: (tenantId: string, days: number) => api.post<void>(`/api/platform-admin/tenants/${tenantId}/trial`, { days }),
  endTrial: (tenantId: string) => api.delete<void>(`/api/platform-admin/tenants/${tenantId}/trial`),
  createTenant: (input: AdminCreateTenantInput) => api.post<{ tenantId: string; userId: string }>("/api/platform-admin/tenants", input),
  grantAccess: (tenantId: string) => api.post<void>(`/api/platform-admin/tenants/${tenantId}/access`),
  revokeAccess: (tenantId: string) => api.delete<void>(`/api/platform-admin/tenants/${tenantId}/access`),

  getMetrics: () => api.get<PlatformMetrics>("/api/platform-admin/metrics"),
};
