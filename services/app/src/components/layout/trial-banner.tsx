"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { billingApi } from "@/lib/api/billing";
import { useCurrentUser } from "@/hooks/use-current-user";

/** Faixa do teste grátis: quantos dias faltam + atalho para assinar (só para quem paga: admin). */
export function TrialBanner() {
  const { can } = useCurrentUser();
  const canManageBilling = can("billing:manage");
  const subscriptionQuery = useQuery({
    queryKey: ["subscription"],
    queryFn: billingApi.getSubscription,
    enabled: canManageBilling,
    staleTime: 5 * 60_000,
  });
  const [now] = useState(() => Date.now());
  const sub = subscriptionQuery.data;
  if (!canManageBilling || !sub || sub.status !== "trialing" || !sub.trialEndsAt) return null;

  const msLeft = new Date(sub.trialEndsAt).getTime() - now;
  if (msLeft <= 0) return null;
  const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
  const endsOn = new Date(sub.trialEndsAt).toLocaleDateString("pt-BR");

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-primary)]/40 bg-blue-50 px-4 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-slate-900">
        <Sparkles className="h-4 w-4 text-[var(--color-primary)]" aria-hidden />
        <span>
          <b>Teste grátis:</b> {daysLeft === 1 ? "último dia" : `faltam ${daysLeft} dias`} (até {endsOn}). Assine para não perder o acesso.
        </span>
      </span>
      <Link
        href="/assinatura"
        className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-primary-foreground)] hover:opacity-90"
      >
        Assinar agora
      </Link>
    </div>
  );
}
