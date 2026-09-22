import Link from "next/link";
import { CompassIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--color-background)] px-4 text-center">
      <CompassIcon className="h-12 w-12 text-slate-300" aria-hidden />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Página não encontrada</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          O endereço acessado não existe ou você não tem permissão para vê-lo.
        </p>
      </div>
      <Button asChild>
        <Link href="/painel">Voltar ao painel</Link>
      </Button>
    </div>
  );
}
