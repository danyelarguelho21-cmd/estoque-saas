import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Ícone "i" com explicação ao passar o mouse (ou focar com o teclado / tocar no celular). */
export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("group relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={text}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-muted)] transition-colors hover:text-[var(--color-primary)] focus-visible:text-[var(--color-primary)] focus-visible:outline-none"
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-40 mt-2 w-72 max-w-[80vw] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs font-normal leading-relaxed text-slate-700 opacity-0 shadow-md transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
