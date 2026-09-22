import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className, label = "Carregando" }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-[var(--color-muted)]">
      <Loader2 className={cn("h-4 w-4 animate-spin", className)} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function PageSpinner({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex min-h-[240px] w-full items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}
