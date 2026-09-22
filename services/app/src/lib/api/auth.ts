import { api } from "./client";

/**
 * Apenas o endpoint de onboarding (`/api/auth/signup`) — não é gerenciado pelo Auth.js.
 * Login/logout usam `signIn`/`signOut` de `next-auth/react` diretamente nos componentes
 * (boundary-safety Pattern 2 — delega ao controle de fluxo do framework de auth).
 */
export interface SignupInput {
  companyName: string;
  cnpj: string;
  adminName: string;
  adminEmail: string;
  password: string;
  planId: string;
}

export interface SignupResult {
  tenantId: string;
  userId: string;
}

export const authApi = {
  signup: (input: SignupInput) => api.post<SignupResult>("/api/auth/signup", input),
};
