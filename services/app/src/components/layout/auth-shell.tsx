import Link from "next/link";
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
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-primary)] text-base font-extrabold text-[var(--color-primary-foreground)] shadow-[0_0_24px_rgb(143_227_91/0.35)]" aria-hidden>z</span>
          Zolo
        </Link>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm sm:p-8">
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
