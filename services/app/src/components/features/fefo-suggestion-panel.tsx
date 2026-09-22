"use client";

import { CheckCircle2, PencilLine } from "lucide-react";
import type { FefoSuggestion } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateBR } from "@/lib/format";

interface FefoSuggestionPanelProps {
  suggestion: FefoSuggestion;
  overridden: boolean;
  onAccept: () => void;
  onOverride: () => void;
}

/**
 * Exibe a sugestão FEFO (ADR-006) e permite sobreposição manual — FEFO é sugestão, nunca
 * bloqueio (BRD, Business Rules). O componente pai é responsável por registrar em
 * `metadata.fefoOverridden` se o operador sobrepôs a sugestão (a API grava isso).
 */
export function FefoSuggestionPanel({ suggestion, overridden, onAccept, onOverride }: FefoSuggestionPanelProps) {
  if (!suggestion.suggestions.length) {
    return <Alert variant="warning">Nenhum lote com saldo disponível para sugestão FEFO.</Alert>;
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-900">Sugestão FEFO (vencimento mais próximo primeiro)</p>
        {!suggestion.fullyCovered && <Badge variant="warning">Saldo insuficiente nos lotes sugeridos</Badge>}
      </div>
      <ul className="flex flex-col gap-1.5 text-sm text-slate-700">
        {suggestion.suggestions.map((item) => (
          <li key={item.batchId} className="flex items-center justify-between">
            <span>Lote vencendo em {formatDateBR(item.expiryDate)}</span>
            <span className="font-medium">{item.quantity} un.</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant={overridden ? "outline" : "primary"} onClick={onAccept}>
          <CheckCircle2 className="h-4 w-4" />
          Usar sugestão
        </Button>
        <Button type="button" size="sm" variant={overridden ? "primary" : "outline"} onClick={onOverride}>
          <PencilLine className="h-4 w-4" />
          Escolher lote manualmente
        </Button>
      </div>
      {overridden && (
        <p className="text-xs text-[var(--color-muted)]">
          Você optou por sobrepor a sugestão — o sistema registra essa escolha na movimentação.
        </p>
      )}
    </div>
  );
}
