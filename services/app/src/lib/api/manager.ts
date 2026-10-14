import { api } from "./client";

export interface ManagerAccessStatus {
  allowed: boolean;
  requiresPin: boolean;
  unlockedUntil: string | null;
  pinConfigured: boolean;
}

export const managerApi = {
  getStatus: () => api.get<ManagerAccessStatus>("/api/manager-unlock"),
  unlock: (pin: string) => api.post<ManagerAccessStatus>("/api/manager-unlock", { pin }),
  lock: () => api.delete<{ allowed: false }>("/api/manager-unlock"),
  getPinConfigured: () => api.get<{ configured: boolean }>("/api/manager-pin"),
  setPin: (pin: string) => api.put<{ configured: boolean }>("/api/manager-pin", { pin }),
  removePin: () => api.delete<{ configured: boolean }>("/api/manager-pin"),
};
