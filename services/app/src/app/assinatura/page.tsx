"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QrCode } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlanCard } from "@/components/features/plan-card";
import { RoleGate } from "@/components/features/role-gate";
import { useToast } from "@/components/ui/toast";
import { billingApi } from "@/lib/api/billing";
import { ApiError } from "@/lib/api/client";
import { formatCentsToBRL, formatDateBR } from "@/lib/format";

const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  trialing: "Período de teste",
  active: "Ativa",
  past_due: "Inadimplente",
  canceled: "Cancelada",
};

const INVOICE_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  paid: "Paga",
  failed: "Falhou",
  overdue: "Vencida",
};

export default function SubscriptionPage() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const subscriptionQuery = useQuery({ queryKey: ["subscription"], queryFn: billingApi.getSubscription });
  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: billingApi.listPlans });
  const invoicesQuery = useQuery({ queryKey: ["invoices"], queryFn: () => billingApi.listInvoices({ limit: 20 }) });

  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);
  const [downgradeError, setDowngradeError] = useState<string | null>(null);

  async function handleChangePlan(planId: string) {
    setChangingPlanId(planId);
    setDowngradeError(null);
    try {
      await billingApi.changePlan(planId);
      notify({ title: "Plano atualizado", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["subscription"] });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDowngradeError(
          "Esse downgrade não é possível agora: seu uso atual excede os limites do plano escolhido. Reduza produtos/usuários/lojas antes de tentar novamente.",
        );
      } else {
        setDowngradeError("Não foi possível alterar o plano agora.");
      }
    } finally {
      setChangingPlanId(null);
    }
  }

  return (
    <AppShell>
      <RoleGate permission="billing:manage" fallback={<EmptyState title="Acesso restrito" description="Apenas administradores podem gerenciar a assinatura." />}>
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Assinatura</h1>
            <p className="text-sm text-[var(--color-muted)]">Plano atual, faturas e upgrade/downgrade</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Plano atual</CardTitle>
            </CardHeader>
            <CardContent>
              {subscriptionQuery.isLoading ? (
                <PageSpinner />
              ) : subscriptionQuery.data ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Badge
                      variant={
                        subscriptionQuery.data.status === "active"
                          ? "success"
                          : subscriptionQuery.data.status === "past_due"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {SUBSCRIPTION_STATUS_LABEL[subscriptionQuery.data.status]}
                    </Badge>
                    <p className="mt-2 text-sm text-[var(--color-muted)]">
                      Ciclo atual: {formatDateBR(subscriptionQuery.data.currentPeriodStart)} —{" "}
                      {formatDateBR(subscriptionQuery.data.currentPeriodEnd)}
                    </p>
                  </div>
                  {subscriptionQuery.data.status === "past_due" && (
                    <Alert variant="danger" title="Pagamento pendente">
                      Regularize sua fatura para evitar restrição de acesso.
                    </Alert>
                  )}
                </div>
              ) : (
                <EmptyState title="Nenhuma assinatura ativa" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Planos disponíveis</CardTitle>
            </CardHeader>
            <CardContent>
              {downgradeError && (
                <Alert variant="danger" className="mb-4" title="Não foi possível trocar de plano">
                  {downgradeError}
                </Alert>
              )}
              {plansQuery.isLoading ? (
                <PageSpinner />
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  {(plansQuery.data ?? []).map((plan) => (
                    <div key={plan.id} className="flex flex-col gap-2">
                      <PlanCard
                        plan={plan}
                        selected={plan.id === subscriptionQuery.data?.planId}
                        currentPlanId={subscriptionQuery.data?.planId}
                        onSelect={handleChangePlan}
                      />
                      {plan.id !== subscriptionQuery.data?.planId && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={changingPlanId === plan.id}
                          onClick={() => handleChangePlan(plan.id)}
                        >
                          Mudar para {plan.name}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Faturas</CardTitle>
            </CardHeader>
            {invoicesQuery.isLoading ? (
              <PageSpinner />
            ) : !invoicesQuery.data?.items.length ? (
              <CardContent>
                <EmptyState title="Nenhuma fatura ainda" />
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Forma</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoicesQuery.data.items.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>{formatDateBR(invoice.dueDate)}</TableCell>
                      <TableCell>{formatCentsToBRL(invoice.amountCents)}</TableCell>
                      <TableCell className="uppercase text-xs">{invoice.paymentMethod}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            invoice.status === "paid" ? "success" : invoice.status === "overdue" || invoice.status === "failed" ? "danger" : "warning"
                          }
                        >
                          {INVOICE_STATUS_LABEL[invoice.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {invoice.status !== "paid" && invoice.boletoUrl && (
                          <a href={invoice.boletoUrl} target="_blank" rel="noreferrer" className="text-[var(--color-primary)] hover:underline">
                            Ver boleto
                          </a>
                        )}
                        {invoice.status !== "paid" && invoice.pixQrCode && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[var(--color-primary)]">
                            <QrCode className="h-4 w-4" aria-hidden />
                            Pix disponível
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      </RoleGate>
    </AppShell>
  );
}
