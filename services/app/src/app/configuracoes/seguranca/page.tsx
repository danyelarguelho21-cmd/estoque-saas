"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ConfigTabs } from "@/components/layout/config-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { RoleGate } from "@/components/features/role-gate";
import { useToast } from "@/components/ui/toast";
import { managerApi } from "@/lib/api/manager";

export default function ManagerPinSettingsPage() {
  return (
    <AppShell>
      <RoleGate
        permission="users:manage"
        fallback={<EmptyState title="Acesso restrito" description="Apenas administradores podem definir a senha do gestor." />}
      >
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Usuários e lojas</h1>
            <p className="text-sm text-[var(--color-muted)]">Senha do gestor para proteger o faturamento</p>
          </div>
          <ConfigTabs active="seguranca" />
          <ManagerPinPanel />
        </div>
      </RoleGate>
    </AppShell>
  );
}

function ManagerPinPanel() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const statusQuery = useQuery({ queryKey: ["manager-pin"], queryFn: managerApi.getPinConfigured });
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!/^\d{4,8}$/.test(pin)) {
      setError("Use de 4 a 8 números.");
      return;
    }
    if (pin !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setSaving(true);
    try {
      await managerApi.setPin(pin);
      setPin("");
      setConfirm("");
      notify({ title: "Senha do gestor salva", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["manager-pin"] });
      await queryClient.invalidateQueries({ queryKey: ["manager-access"] });
    } catch {
      setError("Não foi possível salvar a senha agora.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await managerApi.removePin();
      notify({ title: "Senha do gestor removida", variant: "info" });
      await queryClient.invalidateQueries({ queryKey: ["manager-pin"] });
      await queryClient.invalidateQueries({ queryKey: ["manager-access"] });
    } finally {
      setRemoving(false);
    }
  }

  if (statusQuery.isLoading) return <PageSpinner />;
  const configured = statusQuery.data?.configured ?? false;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--color-primary)]" aria-hidden />
            Como funciona
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-slate-700">
          <p>
            Usuários com papel <b>Vendedor</b> não veem o faturamento: o Painel e o comparativo de vendas ficam bloqueados, e na lista
            de vendas aparecem só as vendas deles.
          </p>
          <p>
            Quando o gestor precisar ver os números no aparelho do vendedor, é só digitar a <b>senha do gestor</b>. A liberação dura
            30 minutos ou até clicar em <b>Bloquear agora</b>.
          </p>
          <p className="text-[var(--color-muted)]">Admin e Operador de estoque continuam vendo tudo normalmente, sem senha.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--color-primary)]" aria-hidden />
            Senha do gestor
          </CardTitle>
          <Badge variant={configured ? "success" : "warning"}>{configured ? "Cadastrada" : "Não cadastrada"}</Badge>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            {error && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {error}
              </p>
            )}
            <Field label={configured ? "Nova senha" : "Senha"} htmlFor="managerPin" hint="De 4 a 8 números" required>
              <Input
                id="managerPin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="Confirmar senha" htmlFor="managerPinConfirm" required>
              <Input
                id="managerPinConfirm"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              {configured && (
                <Button type="button" variant="outline" loading={removing} onClick={handleRemove}>
                  Remover senha
                </Button>
              )}
              <Button type="submit" loading={saving}>
                {configured ? "Trocar senha" : "Salvar senha"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
