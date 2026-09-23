"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, QrCode } from "lucide-react";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { PlanCard } from "@/components/features/plan-card";
import { PageSpinner } from "@/components/ui/spinner";
import { billingApi } from "@/lib/api/billing";
import { authApi } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { cnpjMask } from "@/lib/format";
import { PagBankNotLoadedError, tokenizeCard } from "@/lib/payments/pagbank";
import { cn } from "@/lib/utils";

type PaymentMethod = "card" | "pix_boleto";

export default function SignupPage() {
  const router = useRouter();
  const { update: refreshSession } = useSession();
  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: billingApi.listPlans });

  const [step, setStep] = useState<1 | 2>(1);
  const [planId, setPlanId] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix_boleto");
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleStep1Submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!planId) {
      setError("Escolha um plano para continuar.");
      return;
    }
    setSubmitting(true);
    try {
      await authApi.signup({ companyName, cnpj, adminName, adminEmail, password, planId });
      try {
        await authApi.login({ email: adminEmail, password });
        await refreshSession();
      } catch {
        setError("Empresa criada, mas não foi possível entrar automaticamente. Faça login manualmente.");
        router.push("/entrar");
        return;
      }
      setStep(2);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("CNPJ ou e-mail já cadastrado. Tente entrar ou use outros dados.");
      } else {
        setError("Não foi possível criar sua empresa agora. Tente novamente em instantes.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStep2Submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!planId) return;
    setSubmitting(true);

    try {
      if (paymentMethod === "card") {
        const [expMonth, expYear] = cardExpiry.split("/").map((part) => part.trim());
        const cardToken = await tokenizeCard({
          number: cardNumber,
          holderName: cardHolder,
          expMonth: expMonth ?? "",
          expYear: expYear ?? "",
          cvv: cardCvv,
        });
        await billingApi.createSubscription({ planId, paymentMethod: "card", cardToken });
      } else {
        await billingApi.createSubscription({ planId, paymentMethod: "pix_boleto" });
      }
      router.push("/painel");
    } catch (err) {
      if (err instanceof PagBankNotLoadedError) {
        setError(
          "O checkout por cartão (PagBank.js) ainda não está carregado neste ambiente. Escolha Pix/Boleto para concluir agora, ou tente cartão novamente mais tarde.",
        );
      } else if (err instanceof ApiError && err.status === 402) {
        setError("Pagamento recusado pela operadora. Verifique os dados do cartão ou escolha Pix/Boleto.");
      } else {
        setError("Não foi possível concluir a assinatura agora. Tente novamente.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (plansQuery.isLoading) {
    return <PageSpinner label="Carregando planos…" />;
  }

  const plans = plansQuery.data ?? [];

  return (
    <AuthShell
      title={step === 1 ? "Criar sua empresa" : "Forma de pagamento"}
      description={
        step === 1
          ? "Onboarding self-service — leva menos de 2 minutos"
          : `Plano selecionado: ${plans.find((p) => p.id === planId)?.name ?? ""}`
      }
      wide
    >
      {error && (
        <Alert variant="danger" className="mb-4" title="Ops">
          {error}
        </Alert>
      )}

      {step === 1 && (
        <form onSubmit={handleStep1Submit} className="flex flex-col gap-6" noValidate>
          {plansQuery.isError && (
            <Alert variant="warning">Não foi possível carregar os planos agora. Tente recarregar a página.</Alert>
          )}
          <div>
            <p className="mb-3 text-sm font-medium text-slate-900">Escolha um plano</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} selected={planId === plan.id} onSelect={setPlanId} />
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome da empresa" htmlFor="companyName" required>
              <Input id="companyName" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </Field>
            <Field label="CNPJ" htmlFor="cnpj" required>
              <Input
                id="cnpj"
                required
                value={cnpj}
                onChange={(e) => setCnpj(cnpjMask(e.target.value))}
                placeholder="00.000.000/0000-00"
              />
            </Field>
            <Field label="Seu nome" htmlFor="adminName" required>
              <Input id="adminName" required value={adminName} onChange={(e) => setAdminName(e.target.value)} />
            </Field>
            <Field label="Seu e-mail" htmlFor="adminEmail" required>
              <Input
                id="adminEmail"
                type="email"
                required
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
            </Field>
            <Field label="Senha" htmlFor="password" required hint="Mínimo de 8 caracteres" className="sm:col-span-2">
              <Input
                id="password"
                type="password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </div>

          <Button type="submit" loading={submitting} className="w-full">
            Continuar
          </Button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handleStep2Submit} className="flex flex-col gap-6" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setPaymentMethod("card")}
              aria-pressed={paymentMethod === "card"}
              className={cn(
                "flex items-center gap-3 rounded-lg border-2 p-4 text-left",
                paymentMethod === "card" ? "border-[var(--color-primary)] bg-blue-50/40" : "border-[var(--color-border)]",
              )}
            >
              <CreditCard className="h-5 w-5 text-slate-500" aria-hidden />
              <div>
                <p className="text-sm font-medium text-slate-900">Cartão de crédito</p>
                <p className="text-xs text-[var(--color-muted)]">Cobrança recorrente automática</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod("pix_boleto")}
              aria-pressed={paymentMethod === "pix_boleto"}
              className={cn(
                "flex items-center gap-3 rounded-lg border-2 p-4 text-left",
                paymentMethod === "pix_boleto" ? "border-[var(--color-primary)] bg-blue-50/40" : "border-[var(--color-border)]",
              )}
            >
              <QrCode className="h-5 w-5 text-slate-500" aria-hidden />
              <div>
                <p className="text-sm font-medium text-slate-900">Pix ou boleto</p>
                <p className="text-xs text-[var(--color-muted)]">Cobrança avulsa gerada todo mês</p>
              </div>
            </button>
          </div>

          {paymentMethod === "card" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Número do cartão" htmlFor="cardNumber" required className="sm:col-span-2">
                <Input id="cardNumber" required value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} />
              </Field>
              <Field label="Nome impresso no cartão" htmlFor="cardHolder" required className="sm:col-span-2">
                <Input id="cardHolder" required value={cardHolder} onChange={(e) => setCardHolder(e.target.value)} />
              </Field>
              <Field label="Validade (MM/AAAA)" htmlFor="cardExpiry" required>
                <Input id="cardExpiry" required placeholder="12/2030" value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} />
              </Field>
              <Field label="CVV" htmlFor="cardCvv" required>
                <Input id="cardCvv" required value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} />
              </Field>
            </div>
          )}

          {paymentMethod === "pix_boleto" && (
            <Alert variant="info">
              A cobrança do primeiro ciclo será gerada automaticamente após a confirmação, com QR Code Pix e link de
              boleto disponíveis em <strong>Assinatura → Faturas</strong>.
            </Alert>
          )}

          <Button type="submit" loading={submitting} className="w-full">
            Concluir assinatura
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
