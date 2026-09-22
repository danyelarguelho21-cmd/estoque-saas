import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface PlanLimitBannerProps {
  resourceLabel: string;
  current: number;
  max: number;
}

/**
 * Aviso "aproximando do limite do plano" (BRD Epic 9). O bloqueio real acontece no backend
 * (validação em tempo real na criação); aqui é só o aviso/CTA de upgrade.
 */
export function PlanLimitBanner({ resourceLabel, current, max }: PlanLimitBannerProps) {
  if (max <= 0) return null;
  const ratio = current / max;
  if (ratio < 0.8) return null;
  const atLimit = current >= max;

  return (
    <Alert variant={atLimit ? "danger" : "warning"} title={atLimit ? "Limite do plano atingido" : "Você está perto do limite do plano"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {current} de {max} {resourceLabel} do seu plano atual.
          {atLimit
            ? " Novos registros serão bloqueados até você fazer upgrade."
            : " Considere um upgrade para não ser interrompido."}
        </span>
        <Button asChild size="sm" variant={atLimit ? "danger" : "outline"}>
          <Link href="/assinatura">Ver planos</Link>
        </Button>
      </div>
    </Alert>
  );
}
