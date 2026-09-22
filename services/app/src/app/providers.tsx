"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    // basePath deve bater com o basePath do NextAuth no servidor (auth.config.ts:
    // "/api/auth/nextauth-internal" — separado de /api/auth/{login,signup,logout}, as rotas REST
    // próprias do contrato em api/openapi/auth.yaml). Sem isto, useSession()/signIn()/signOut()
    // (next-auth/react) usam o basePath PADRÃO ("/api/auth"), que não existe mais nessas rotas —
    // a resposta 404 do Next.js (HTML) quebra o parse de JSON do NextAuth com um erro genérico
    // "Unexpected token '<' ... is not valid JSON" (bug real, encontrado testando o login num
    // navegador de verdade — não aparecia em nenhuma verificação via curl/API direta).
    <SessionProvider basePath="/api/auth/nextauth-internal">
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
