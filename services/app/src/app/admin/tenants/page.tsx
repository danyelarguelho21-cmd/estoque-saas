"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "@/components/layout/admin-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { platformAdminApi } from "@/lib/api/admin";
import { billingApi } from "@/lib/api/billing";
import { ApiError } from "@/lib/api/client";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { formatDateBR } from "@/lib/format";
import type { SubscriptionStatus, TenantAdminSummary } from "@/lib/api/types";

const STATUS_OPTIONS = [
  { value: "__all__", label: "Todos os status" },
  { value: "pending_payment", label: "Pagamento pendente" },
  { value: "trialing", label: "Teste" },
  { value: "active", label: "Ativa" },
  { value: "past_due", label: "Inadimplente" },
  { value: "canceled", label: "Cancelada" },
];

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  pending_payment: "Pagamento pendente",
  trialing: "Teste",
  active: "Ativa",
  past_due: "Inadimplente",
  canceled: "Cancelada",
};

const TRIAL_DAY_OPTIONS = [
  { value: "7", label: "7 dias" },
  { value: "15", label: "15 dias" },
  { value: "30", label: "30 dias" },
  { value: "60", label: "60 dias" },
];

const STATUS_BADGE: Record<SubscriptionStatus, "success" | "danger" | "neutral" | "info"> = {
  pending_payment: "info",
  trialing: "info",
  active: "success",
  past_due: "danger",
  canceled: "neutral",
};

export default function PlatformTenantsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);

  const tenantsQuery = useQuery({
    queryKey: ["platform-tenants", statusFilter, cursor],
    queryFn: () =>
      platformAdminApi.listTenants({
        subscriptionStatus: statusFilter === "__all__" ? undefined : (statusFilter as SubscriptionStatus),
        cursor,
        limit: 20,
      }),
  });

  function goNext() {
    if (!tenantsQuery.data?.page.next_cursor) return;
    setCursorHistory((h) => [...h, cursor ?? ""]);
    setCursor(tenantsQuery.data.page.next_cursor);
  }
  function goPrevious() {
    setCursorHistory((h) => {
      const next = [...h];
      const previous = next.pop();
      setCursor(previous || undefined);
      return next;
    });
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
  }

  return (
    <AdminShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">Assinantes</h1>
            <p className="text-sm text-slate-400">Todos os tenants da plataforma</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <NewTenantDialog onDone={refresh} />
            <div className="w-[200px]">
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setCursor(undefined);
                setCursorHistory([]);
                setStatusFilter(v);
              }}
              options={STATUS_OPTIONS}
            />
            </div>
          </div>
        </div>

        <Card className="border-slate-800 bg-slate-900">
          {tenantsQuery.isLoading ? (
            <PageSpinner />
          ) : !tenantsQuery.data?.items.length ? (
            <EmptyState title="Nenhum tenant encontrado" className="border-slate-800 text-slate-300" />
          ) : (
            <>
              <Table className="text-slate-200">
                <TableHeader className="bg-slate-800 text-slate-400">
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Assinatura</TableHead>
                    <TableHead>Status da conta</TableHead>
                    <TableHead>Desde</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-slate-800">
                  {tenantsQuery.data.items.map((tenant) => (
                    <TableRow key={tenant.id} className="hover:bg-slate-800/50">
                      <TableCell className="text-slate-100">
                        {tenant.name}
                        <span className="block text-xs text-slate-500">{tenant.cnpj ?? tenant.cpf}</span>
                      </TableCell>
                      <TableCell>{tenant.planName}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE[tenant.subscriptionStatus]}>{STATUS_LABEL[tenant.subscriptionStatus]}</Badge>
                        {tenant.courtesyAccess && <span className="mt-1 block text-xs text-slate-400">cortesia (sem cobrança)</span>}
                        {tenant.subscriptionStatus === "trialing" && tenant.trialEndsAt && (
                          <span className="mt-1 block text-xs text-slate-400">até {formatDateBR(tenant.trialEndsAt)}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={tenant.status === "active" ? "success" : tenant.status === "suspended" ? "danger" : "neutral"}>
                          {tenant.status === "active" ? "Ativa" : tenant.status === "suspended" ? "Suspensa" : "Cancelada"}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDateBR(tenant.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <TrialAction tenant={tenant} onDone={refresh} />
                          <AccessAction tenant={tenant} onDone={refresh} />
                          <TenantAction tenant={tenant} onDone={refresh} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                hasMore={tenantsQuery.data.page.has_more}
                onNext={goNext}
                onPrevious={goPrevious}
                canGoBack={cursorHistory.length > 0}
                loading={tenantsQuery.isFetching}
              />
            </>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}

const ACCESS_OPTIONS = [
  { value: "courtesy", label: "Acesso liberado (cortesia, sem prazo)" },
  { value: "trial", label: "Teste grátis com prazo" },
  { value: "pending", label: "Aguardando pagamento (normal)" },
];

function NewTenantDialog({ onDone }: { onDone: () => void }) {
  const { notify } = useToast();
  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: billingApi.listPlans });
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personType, setPersonType] = useState<"PJ" | "PF">("PJ");
  const [companyName, setCompanyName] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");
  const [planId, setPlanId] = useState("");
  const [access, setAccess] = useState("courtesy");
  const [days, setDays] = useState("15");

  const planOptions = (plansQuery.data ?? []).map((plan) => ({ value: plan.id, label: plan.name }));

  function reset() {
    setPersonType("PJ"); setCompanyName(""); setDocNumber(""); setAdminName(""); setAdminEmail("");
    setPassword(""); setPlanId(""); setAccess("courtesy"); setDays("15"); setError(null);
  }

  async function handleSubmit() {
    setError(null);
    if (!companyName || !docNumber || !adminName || !adminEmail || password.length < 8 || !planId) {
      setError("Preencha todos os campos. A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    setSubmitting(true);
    try {
      const accessValue =
        access === "trial" ? { type: "trial" as const, days: Number(days) } : access === "pending" ? { type: "pending" as const } : { type: "courtesy" as const };
      const base = { companyName, adminName, adminEmail, password, planId, access: accessValue };
      await platformAdminApi.createTenant(personType === "PJ" ? { ...base, personType, cnpj: docNumber } : { ...base, personType, cpf: docNumber });
      notify({ title: `Cadastro de ${companyName} criado`, description: `Login: ${adminEmail}`, variant: "success" });
      setOpen(false);
      reset();
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError(err.message || "CNPJ/CPF ou e-mail já cadastrado.");
      else if (err instanceof ApiError && (err.status === 400 || err.status === 422)) setError("Confira os dados: CNPJ/CPF, e-mail e senha.");
      else setError("Não foi possível criar o cadastro agora.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm">+ Novo cadastro</Button>
      </DialogTrigger>
      <DialogContent title="Novo cadastro de cliente" description="Cria a empresa e o login do cliente. Envie o e-mail e a senha para ele entrar.">
        <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
          <Field label="Tipo" htmlFor="nt-type">
            <Select id="nt-type" value={personType} onValueChange={(v) => setPersonType(v as "PJ" | "PF")}
              options={[{ value: "PJ", label: "Empresa (CNPJ)" }, { value: "PF", label: "Pessoa física (CPF)" }]} />
          </Field>
          <Field label={personType === "PJ" ? "Nome da empresa" : "Nome do negócio"} htmlFor="nt-company" required>
            <Input id="nt-company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </Field>
          <Field label={personType === "PJ" ? "CNPJ" : "CPF"} htmlFor="nt-doc" required>
            <Input id="nt-doc" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Nome do responsável" htmlFor="nt-admin" required>
            <Input id="nt-admin" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
          </Field>
          <Field label="E-mail de login" htmlFor="nt-email" required>
            <Input id="nt-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
          </Field>
          <Field label="Senha inicial" htmlFor="nt-pass" required hint="Mínimo de 8 caracteres. O cliente pode trocar depois.">
            <Input id="nt-pass" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Plano" htmlFor="nt-plan" required>
            <Select id="nt-plan" value={planId} onValueChange={setPlanId} options={planOptions} placeholder="Escolha o plano" />
          </Field>
          <Field label="Acesso" htmlFor="nt-access" required>
            <Select id="nt-access" value={access} onValueChange={setAccess} options={ACCESS_OPTIONS} />
          </Field>
          {access === "trial" && (
            <Field label="Prazo do teste" htmlFor="nt-days">
              <Select id="nt-days" value={days} onValueChange={setDays} options={TRIAL_DAY_OPTIONS} />
            </Field>
          )}
          {error && <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button loading={submitting} onClick={() => void handleSubmit()}>Criar cadastro</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrialAction({ tenant, onDone }: { tenant: TenantAdminSummary; onDone: () => void }) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("15");
  const [submitting, setSubmitting] = useState(false);
  const onTrial = tenant.subscriptionStatus === "trialing" && Boolean(tenant.trialEndsAt);

  // Cliente pagante ou conta cancelada: nada a liberar.
  if (tenant.subscriptionStatus === "active" || tenant.status === "canceled") return null;

  async function handleConfirm() {
    setSubmitting(true);
    try {
      if (onTrial) {
        await platformAdminApi.endTrial(tenant.id);
        notify({ title: `Teste de ${tenant.name} encerrado`, variant: "info" });
      } else {
        await platformAdminApi.grantTrial(tenant.id, Number(days));
        notify({ title: `Teste liberado para ${tenant.name} por ${days} dias`, variant: "success" });
      }
      setOpen(false);
      onDone();
    } catch (err) {
      notify({ title: "Não foi possível concluir", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {onTrial ? "Encerrar teste" : "Liberar teste"}
        </Button>
      </DialogTrigger>
      <DialogContent title={onTrial ? "Encerrar período de teste" : "Liberar período de teste"}>
        {onTrial ? (
          <p className="text-sm text-slate-600">
            {tenant.name} perde o acesso agora e precisará pagar a assinatura para continuar usando o sistema.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600">
              {tenant.name} terá acesso completo ao plano {tenant.planName} sem pagar, pelo prazo escolhido. Ao fim do
              prazo, o acesso é bloqueado e o cliente vê a tela de pagamento.
            </p>
            <Select value={days} onValueChange={setDays} options={TRIAL_DAY_OPTIONS} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant={onTrial ? "danger" : "primary"} loading={submitting} onClick={handleConfirm}>
            {onTrial ? "Encerrar teste" : "Liberar teste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccessAction({ tenant, onDone }: { tenant: TenantAdminSummary; onDone: () => void }) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const revoking = tenant.courtesyAccess;

  // Cliente pagante (ativo com assinatura no gateway) ou conta cancelada: nada a fazer aqui.
  if (tenant.status === "canceled" || (tenant.subscriptionStatus === "active" && !tenant.courtesyAccess)) return null;

  async function handleConfirm() {
    setSubmitting(true);
    try {
      if (revoking) {
        await platformAdminApi.revokeAccess(tenant.id);
        notify({ title: `Acesso de ${tenant.name} removido`, variant: "info" });
      } else {
        await platformAdminApi.grantAccess(tenant.id);
        notify({ title: `Acesso liberado para ${tenant.name}`, variant: "success" });
      }
      setOpen(false);
      onDone();
    } catch (err) {
      notify({ title: "Não foi possível concluir", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={revoking ? "danger" : "outline"}>
          {revoking ? "Remover acesso" : "Liberar acesso"}
        </Button>
      </DialogTrigger>
      <DialogContent title={revoking ? "Remover acesso liberado" : "Liberar acesso sem cobrança"}>
        <p className="text-sm text-slate-600">
          {revoking
            ? `${tenant.name} perde o acesso agora e precisará pagar a assinatura para continuar usando o sistema.`
            : `${tenant.name} terá acesso completo ao plano ${tenant.planName}, sem cobrança e sem prazo para acabar, até você remover. Use para parceiros ou cortesias.`}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant={revoking ? "danger" : "primary"} loading={submitting} onClick={handleConfirm}>
            {revoking ? "Remover acesso" : "Liberar acesso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TenantAction({ tenant, onDone }: { tenant: TenantAdminSummary; onDone: () => void }) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const suspending = tenant.status === "active";

  async function handleConfirm() {
    setSubmitting(true);
    try {
      if (suspending) {
        await platformAdminApi.suspendTenant(tenant.id);
        notify({ title: `${tenant.name} suspenso`, variant: "info" });
      } else {
        await platformAdminApi.reactivateTenant(tenant.id);
        notify({ title: `${tenant.name} reativado`, variant: "success" });
      }
      setOpen(false);
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  if (tenant.status === "canceled") {
    return <span className="text-xs text-slate-600">—</span>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={suspending ? "danger" : "outline"}>
          {suspending ? "Suspender" : "Reativar"}
        </Button>
      </DialogTrigger>
      <DialogContent title={suspending ? "Suspender tenant" : "Reativar tenant"}>
        <p className="text-sm text-slate-600">
          {suspending
            ? `${tenant.name} perderá acesso ao sistema imediatamente. Use para inadimplência crítica ou abuso.`
            : `${tenant.name} recuperará acesso normal ao sistema.`}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant={suspending ? "danger" : "primary"} loading={submitting} onClick={handleConfirm}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
