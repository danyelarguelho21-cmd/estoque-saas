"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, LockOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageSpinner } from "@/components/ui/spinner";
import { managerApi } from "@/lib/api/manager";
import { ApiError } from "@/lib/api/client";

/** Situação da área do gestor (faturamento) para o usuário logado. */
export function useManagerAccess() {
  const query = useQuery({ queryKey: ["manager-access"], queryFn: managerApi.getStatus, staleTime: 15_000 });
  return {
    isLoading: query.isLoading,
    allowed: query.data?.allowed ?? false,
    requiresPin: query.data?.requiresPin ?? false,
    unlockedUntil: query.data?.unlockedUntil ?? null,
    pinConfigured: query.data?.pinConfigured ?? false,
  };
}

function useRefreshAfterAccessChange() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ["manager-access"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["sales"] });
    await queryClient.invalidateQueries({ queryKey: ["monthly-sales"] });
  };
}

/** Formulário de PIN do gestor. `compact` = versão menor para dentro de um card. */
export function ManagerUnlockForm({ compact = false }: { compact?: boolean }) {
  const { pinConfigured, isLoading } = useManagerAccess();
  const refresh = useRefreshAfterAccessChange();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    setSubmitting(true);
    setError(null);
    try {
      await managerApi.unlock(pin);
      setPin("");
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError("Muitas tentativas. Aguarde alguns minutos.");
      else setError("Senha do gestor incorreta.");
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) return <PageSpinner />;

  return (
    <div className={compact ? "flex flex-col items-center gap-3 py-6 text-center" : "flex flex-col items-center gap-4 py-10 text-center"}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-input)] text-[var(--color-primary)] ring-1 ring-[var(--color-border)]">
        <Lock className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <p className="text-base font-semibold text-slate-900">Área do gestor</p>
        <p className="mt-1 max-w-sm text-sm text-[var(--color-muted)]">
          {pinConfigured
            ? "O faturamento é restrito. Peça para o gestor digitar a senha para liberar por 30 minutos."
            : "O faturamento é restrito ao gestor. O administrador ainda não cadastrou a senha do gestor (Usuários e lojas > Senha do gestor)."}
        </p>
      </div>
      {pinConfigured && (
        <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-2" noValidate>
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            placeholder="Senha do gestor"
            aria-label="Senha do gestor"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="text-center tracking-[0.4em]"
          />
          {error && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
          <Button type="submit" loading={submitting} disabled={pin.length < 4}>
            Liberar
          </Button>
        </form>
      )}
    </div>
  );
}

/** Faixa mostrada ao vendedor enquanto a área do gestor está liberada, com botão para bloquear. */
export function ManagerUnlockedBar() {
  const { requiresPin, allowed, unlockedUntil } = useManagerAccess();
  const refresh = useRefreshAfterAccessChange();
  if (!requiresPin || !allowed || !unlockedUntil) return null;
  const until = new Date(unlockedUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-primary)]/40 bg-blue-50 px-4 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-slate-900">
        <LockOpen className="h-4 w-4 text-[var(--color-primary)]" aria-hidden />
        Área do gestor liberada até {until}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={async () => {
          await managerApi.lock();
          await refresh();
        }}
      >
        <Lock className="h-4 w-4" aria-hidden />
        Bloquear agora
      </Button>
    </div>
  );
}

/** Mostra `children` só para quem tem acesso ao faturamento; senão, o pedido de senha do gestor. */
export function ManagerGate({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  const { isLoading, allowed } = useManagerAccess();
  if (isLoading) return <PageSpinner />;
  if (!allowed) {
    return compact ? (
      <ManagerUnlockForm compact />
    ) : (
      <Card>
        <CardContent>
          <ManagerUnlockForm />
        </CardContent>
      </Card>
    );
  }
  return <>{children}</>;
}
