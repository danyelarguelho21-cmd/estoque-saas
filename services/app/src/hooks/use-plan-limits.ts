"use client";

import { useQuery } from "@tanstack/react-query";
import { billingApi } from "@/lib/api/billing";

/** Resolve o plano atual do tenant (limites de produtos/usuários/lojas) para uso em avisos de limite. */
export function usePlanLimits() {
  const subscriptionQuery = useQuery({ queryKey: ["subscription"], queryFn: billingApi.getSubscription });
  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: billingApi.listPlans });

  const currentPlan = plansQuery.data?.find((plan) => plan.id === subscriptionQuery.data?.planId);

  return {
    plan: currentPlan,
    isLoading: subscriptionQuery.isLoading || plansQuery.isLoading,
  };
}
