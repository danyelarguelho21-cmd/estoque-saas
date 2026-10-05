"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, QrCode } from "lucide-react";
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
import { BillingAddressFields, type BillingAddressErrors } from "@/components/features/billing-address-fields";
import { useToast } from "@/components/ui/toast";
import { billingApi } from "@/lib/api/billing";
import { tenantsApi } from "@/lib/api/tenants";
import type { Tenant } from "@/lib/api/types";
import { EMPTY_BILLING_ADDRESS, validateBillingAddress, type BillingAddressInput } from "@/lib/billing-address";
import { ApiError } from "@/lib/api/client";
import { formatCentsToBRL, formatDateBR } from "@/lib/format";

const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  pending_payment: "Pagamento pendente",
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

function hasBillingAddress(tenant: Tenant): boolean {
  return Boolean(tenant.billingZipcode && tenant.billingStreet && tenant.billingNumber && tenant.billingCity && tenant.billingState);
}

export default function SubscriptionPage() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const subscriptionQuery = useQuery({
    queryKey: ["subscription"],
    queryFn: billingApi.getSubscription,
    refetchInterval: (query) =>
      query.state.data?.status === "pending_payment" || query.state.data?.status === "past_due" ? 5000 : false,
  });
  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: billingApi.listPlans });
  const tenantQuery = useQuery({ queryKey: ["tenant"], queryFn: tenantsApi.getTenant });
  const invoicesQuery = useQuery({
    queryKey: ["invoices"],
    queryFn: () => billingApi.listInvoices({ limit: 20 }),
    refetchInterval: subscriptionQuery.data?.status === "pending_payment" || subscriptionQuery.data?.status === "past_due" ? 5000 : false,
  });

  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);
  const [downgradeError, setDowngradeError] = useState<string | null>(null);
  const [copiedInvoiceId, setCopiedInvoiceId] = useState<string | null>(null);
  const [retryingCheckout, setRetryingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [billingAddress, setBillingAddress] = useState<BillingAddressInput>(EMPTY_BILLING_ADDRESS);
  const [billingAddressErrors, setBillingAddressErrors] = useState<BillingAddressErrors>({});

  const pendingInvoice = invoicesQuery.data?.items.find((invoice) => invoice.status === "pending" || invoice.status === "overdue");
  // Tenants criados antes da coleta de endereço: o Pix da Vindi é recusado sem ele, então o
  // endereço é pedido aqui antes de gerar a cobrança.
  const needsBillingAddress = tenantQuery.data ? !hasBillingAddress(tenantQuery.data) : false;
  // Fatura aberta sem QR Code (ex.: recusada pelo gateway por falta de endereço) também precisa de
  // uma nova cobrança — o backend substitui a assinatura pendente na Vindi.
  const pendingInvoiceWithoutPix = pendingInvoice?.paymentMethod === "pix" && !pendingInvoice.pixQrCode;
  const canGeneratePix = subscriptionQuery.data?.status === "pending_payment" && (!pendingInvoice || pendingInvoiceWithoutPix);

  async function retryPixCheckout() {
    const planId = subscriptionQuery.data?.planId;
    if (!planId) return;
    setRetryingCheckout(true);
    setCheckoutError(null);
    try {
      if (needsBillingAddress) {
        const address = validateBillingAddress(billingAddress);
        if (!address.ok) {
          setBillingAddressErrors(address.errors);
          setCheckoutError("Confira o endereço de cobrança antes de gerar o Pix.");
          return;
        }
        setBillingAddressErrors({});
        const tenant = await tenantsApi.updateBillingAddress(address.data);
        queryClient.setQueryData(["tenant"], tenant);
      }
      const checkout = await billingApi.createSubscription({ planId, paymentMethod: "pix_boleto" });
      if (!checkout.invoice?.pixQrCode && !checkout.invoice?.boletoUrl) {
        throw new Error("A cobrança foi solicitada, mas a Vindi não retornou o QR Code nem o link da fatura. Tente novamente em instantes.");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subscription"] }),
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
      ]);
    } catch (err) {
      setCheckoutError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Não foi possível gerar a cobrança Pix. Tente novamente.");
    } finally {
      setRetryingCheckout(false);
    }
  }

  async function copyPixCode(invoiceId: string, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedInvoiceId(invoiceId);
      notify({ title: "Código Pix copiado", variant: "success" });
    } catch {
      notify({ title: "Não foi possível copiar", description: "Selecione e copie o código Pix manualmente.", variant: "error" });
    }
  }

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
                  {subscriptionQuery.data.status === "trialing" && subscriptionQuery.data.trialEndsAt && new Date(subscriptionQuery.data.trialEndsAt) > new Date() && (
                    <Alert variant="info" title="Período de teste liberado">
                      Você tem acesso completo até {formatDateBR(subscriptionQuery.data.trialEndsAt)}. Depois dessa data, será preciso
                      pagar a assinatura para continuar usando o sistema.
                    </Alert>
                  )}
                  {(subscriptionQuery.data.status === "pending_payment" ||
                    (subscriptionQuery.data.status === "trialing" &&
                      !(subscriptionQuery.data.trialEndsAt && new Date(subscriptionQuery.data.trialEndsAt) > new Date()))) && (
                    <Alert variant="warning" title="Aguardando primeiro pagamento">
                      Pague a fatura abaixo para liberar o acesso completo ao sistema.
                    </Alert>
                  )}
                </div>
              ) : (
                <EmptyState title="Nenhuma assinatura ativa" />
              )}
            </CardContent>
          </Card>

          {invoicesQuery.data?.items
            .filter((invoice) => invoice.status !== "paid" && invoice.paymentMethod === "pix" && invoice.pixQrCode)
            .slice(0, 1)
            .map((invoice) => (
              <Card key={invoice.id} className="border-2 border-[var(--color-primary)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" aria-hidden /> Pague sua assinatura via Pix</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-5 sm:grid-cols-[220px_1fr]">
                  <div className="flex min-h-52 items-center justify-center rounded-lg bg-white p-3">
                    {invoice.pixQrCodeImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- PNG gerado na rota autenticada pix-qr (no-store); next/image não agrega nada aqui
                      <img src={`/api/billing/invoices/${invoice.id}/pix-qr`} alt="QR Code Pix para pagar a assinatura" width={196} height={196} />
                    ) : <p className="max-w-44 text-center text-sm text-[var(--color-muted)]">Use o código Pix ao lado para pagar pelo aplicativo do seu banco.</p>}
                  </div>
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-[var(--color-muted)]">Escaneie o QR Code no aplicativo do seu banco ou copie o código Pix. O acesso é liberado após a confirmação do pagamento.</p>
                    <p className="text-sm font-semibold">{formatCentsToBRL(invoice.amountCents)} · vence em {formatDateBR(invoice.dueDate)}</p>
                    <textarea readOnly value={invoice.pixQrCode ?? ""} aria-label="Código Pix copia e cola" className="min-h-24 w-full rounded-md border border-[var(--color-border)] p-3 text-xs" />
                    <Button type="button" variant="outline" onClick={() => void copyPixCode(invoice.id, invoice.pixQrCode!)}>
                      {copiedInvoiceId === invoice.id ? <Check className="mr-2 h-4 w-4" aria-hidden /> : <Copy className="mr-2 h-4 w-4" aria-hidden />}
                      {copiedInvoiceId === invoice.id ? "Copiado" : "Copiar código Pix"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}

          {canGeneratePix && (
            <Card>
              <CardContent className="flex flex-col items-start gap-3 pt-6">
                <p className="text-sm text-[var(--color-muted)]">
                  {pendingInvoiceWithoutPix
                    ? "A fatura em aberto não tem QR Code Pix. Gere uma nova cobrança para pagar via Pix."
                    : "Ainda não há cobrança Pix disponível para esta assinatura."}
                </p>
                {needsBillingAddress && (
                  <div className="w-full">
                    <p className="mb-1 text-sm font-medium text-slate-900">Endereço de cobrança</p>
                    <p className="mb-3 text-xs text-[var(--color-muted)]">Obrigatório para gerar o Pix da assinatura.</p>
                    <BillingAddressFields value={billingAddress} onChange={setBillingAddress} errors={billingAddressErrors} idPrefix="assinatura-billing" />
                  </div>
                )}
                {checkoutError && <Alert variant="danger">{checkoutError}</Alert>}
                <Button type="button" loading={retryingCheckout} disabled={tenantQuery.isLoading} onClick={() => void retryPixCheckout()}>
                  {needsBillingAddress ? "Salvar endereço e gerar cobrança Pix" : pendingInvoiceWithoutPix ? "Gerar nova cobrança Pix" : "Gerar cobrança Pix"}
                </Button>
              </CardContent>
            </Card>
          )}

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
                            Pagar fatura
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
