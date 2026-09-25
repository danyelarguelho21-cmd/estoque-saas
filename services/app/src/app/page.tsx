"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { PageSpinner } from "@/components/ui/spinner";

/**
 * Raiz do app: nunca renderiza conteúdo próprio — apenas encaminha para a área correta com
 * base na sessão (Pattern 2 — delega ao Auth.js, não replica lógica de auth aqui).
 */
export default function HomePage() {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/painel");
    } else if (status === "unauthenticated") {
      router.replace("/entrar");
    }
  }, [status, router]);

  return <PageSpinner label="Carregando Zolo…" />;
}
