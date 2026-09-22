import { api, buildQuery } from "./client";
import type { Paginated, Role, Store, StoreInput, Tenant, UserSummary } from "./types";

export const tenantsApi = {
  getTenant: () => api.get<Tenant>("/api/tenant"),
  updateTenant: (input: Partial<Pick<Tenant, "consolidatedStock" | "perishableTrackingEnabled">>) =>
    api.patch<void>("/api/tenant", input),

  listStores: (params: { cursor?: string | undefined; limit?: number | undefined } = {}) =>
    api.get<Paginated<Store>>(`/api/stores${buildQuery(params)}`),
  createStore: (input: StoreInput) => api.post<Store>("/api/stores", input),
  updateStore: (storeId: string, input: StoreInput) => api.patch<Store>(`/api/stores/${storeId}`, input),

  listUsers: (params: { cursor?: string | undefined; limit?: number | undefined } = {}) =>
    api.get<Paginated<UserSummary>>(`/api/users${buildQuery(params)}`),
  inviteUser: (input: { name: string; email: string; role: Role }) =>
    api.post<void>("/api/users/invite", input),
  updateUserRole: (userId: string, role: Role) => api.patch<void>(`/api/users/${userId}/role`, { role }),
};
