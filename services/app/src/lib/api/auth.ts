import type { BillingAddressInput } from "@/lib/billing-address";
import { api } from "./client";

/**
 * Endpoints próprios do contrato (`/api/auth/signup` e `/api/auth/login`). Logout continua
 * usando `signOut` de `next-auth/react` para deixar o framework limpar a sessão no navegador.
 */
export type SignupInput =
  | {
      personType: "PJ";
      companyName: string;
      cnpj: string;
      adminName: string;
      adminEmail: string;
      password: string;
      planId: string;
      billingAddress: BillingAddressInput;
    }
  | {
      personType: "PF";
      companyName: string;
      cpf: string;
      adminName: string;
      adminEmail: string;
      password: string;
      planId: string;
      billingAddress: BillingAddressInput;
    };

export interface SignupResult {
  tenantId: string;
  userId: string;
}

export const authApi = {
  signup: (input: SignupInput) => api.post<SignupResult>("/api/auth/signup", input),
  login: (input: { email: string; password: string }) => api.post<{ status: "ok" }>("/api/auth/login", input),
};
