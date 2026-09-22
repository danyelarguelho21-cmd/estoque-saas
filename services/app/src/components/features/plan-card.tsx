import { Check } from "lucide-react";
import type { Plan } from "@/lib/api/types";
import { formatCentsToBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PlanCardProps {
  plan: Plan;
  selected: boolean;
  onSelect: (planId: string) => void;
  currentPlanId?: string | undefined;
}

export function PlanCard({ plan, selected, onSelect, currentPlanId }: PlanCardProps) {
  const isCurrent = currentPlanId === plan.id;

  return (
    <button
      type="button"
      onClick={() => onSelect(plan.id)}
      aria-pressed={selected}
      className={cn(
        "flex w-full flex-col gap-3 rounded-lg border-2 p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]",
        selected ? "border-[var(--color-primary)] bg-blue-50/40" : "border-[var(--color-border)] bg-white hover:border-slate-300",
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">{plan.name}</h3>
        {isCurrent && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Plano atual</span>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-900">
        {formatCentsToBRL(plan.priceCents)}
        <span className="text-sm font-normal text-[var(--color-muted)]">/mês</span>
      </p>
      <ul className="flex flex-col gap-1.5 text-sm text-slate-600">
        <li className="flex items-center gap-2">
          <Check className="h-4 w-4 text-[var(--color-success)]" aria-hidden />
          Até {plan.maxProducts} produtos
        </li>
        <li className="flex items-center gap-2">
          <Check className="h-4 w-4 text-[var(--color-success)]" aria-hidden />
          Até {plan.maxUsers} usuários
        </li>
        <li className="flex items-center gap-2">
          <Check className="h-4 w-4 text-[var(--color-success)]" aria-hidden />
          Até {plan.maxStores} lojas/depósitos
        </li>
      </ul>
    </button>
  );
}
