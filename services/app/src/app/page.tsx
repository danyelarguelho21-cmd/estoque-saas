"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { PageSpinner } from "@/components/ui/spinner";
import { LandingPage } from "@/components/marketing/landing-page";

/**
 * Raiz do app: usuário autenticado é encaminhado pro painel (Pattern 2 — delega ao Auth.js).
 * Visitante não-autenticado vê a landing page pública direto aqui, em vez de ser redirecionado
 * pra /entrar — é a página de apresentação do produto antes do cadastro/pagamento.
 */
export default function HomePage() {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/painel");
    }
  }, [status, router]);

  if (status === "authenticated" || status === "loading") {
    return <PageSpinner label="Carregando Zolo…" />;
  }

  return <LandingPage />;
}
