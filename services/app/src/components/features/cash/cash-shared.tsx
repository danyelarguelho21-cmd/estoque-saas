"use client";

import { Banknote, CreditCard, HelpCircle, QrCode, Wallet } from "lucide-react";
import type { ComponentType } from "react";
import { formatCentsToBRL } from "@/lib/format";
import { CASH_METHODS, type CashByMethod, type CashMethodKey } from "@/lib/api/cash";

const ICONS: Record<CashMethodKey, ComponentType<{ className?: string }>> = {
  dinheiro: Banknote,
  pix: QrCode,
  cartao_debito: CreditCard,
  cartao_credito: CreditCard,
  outro: Wallet,
  nao_informado: HelpCircle,
};

/** Quanto entrou em cada forma de pagamento. "Outro" e "Não informado" só aparecem se tiver valor. */
export function MethodTotals({ byMethod }: { byMethod: CashByMethod }) {
  const methods = CASH_METHODS.filter((m) => byMethod[m.key] > 0 || !["outro", "nao_informado"].includes(m.key));
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {methods.map((m) => {
        const Icon = ICONS[m.key];
        return (
          <div key={m.key} className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] p-3">
            <Icon className="h-5 w-5 shrink-0 text-[var(--color-primary)]" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-xs text-[var(--color-muted)]">{m.label}</p>
              <p className="text-base font-semibold text-slate-900">{formatCentsToBRL(byMethod[m.key])}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
