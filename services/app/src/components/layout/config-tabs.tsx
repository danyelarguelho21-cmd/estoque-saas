import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "lojas", href: "/configuracoes/lojas", label: "Lojas e depósitos" },
  { key: "usuarios", href: "/configuracoes/usuarios", label: "Usuários" },
] as const;

export function ConfigTabs({ active }: { active: "lojas" | "usuarios" }) {
  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-md bg-slate-100 p-1">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            "rounded-sm px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors",
            active === tab.key && "bg-white text-slate-900 shadow-sm",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
