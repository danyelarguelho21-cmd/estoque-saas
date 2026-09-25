import Link from "next/link";
import { Boxes } from "lucide-react";
import type { ReactNode } from "react";

/** Shell para telas públicas de onboarding/login — card centralizado. */
export function AuthShell({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--color-background)] px-4 py-10">
      <div className={wide ? "w-full max-w-2xl" : "w-full max-w-md"}>
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 text-lg font-semibold text-slate-900">
          <Boxes className="h-7 w-7 text-[var(--color-primary)]" aria-hidden />
          Zolo
        </Link>
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
            {description && <p className="mt-1 text-sm text-[var(--color-muted)]">{description}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
