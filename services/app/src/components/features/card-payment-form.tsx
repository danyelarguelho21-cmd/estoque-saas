"use client";

import { useState, type FormEvent } from "react";
import { CreditCard } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { billingApi } from "@/lib/api/billing";
import { ApiError } from "@/lib/api/client";
import { PagBankNotLoadedError, tokenizeCard } from "@/lib/payments/pagbank";

function formatCardNumber(value: string) {
  return value.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
}
function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

/** Pagamento da assinatura com cartão de crédito (cobrança recorrente mensal). */
export function CardPaymentForm({ planId, onPaid }: { planId: string; onPaid: (active: boolean) => void | Promise<void> }) {
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const [expMonth, expYear] = expiry.split("/").map((part) => part.trim());
    if (number.replace(/\D/g, "").length < 13 || !holder.trim() || !expMonth || !expYear || cvv.length < 3) {
      setError("Preencha todos os dados do cartão.");
      return;
    }
    setSubmitting(true);
    try {
      const cardToken = await tokenizeCard({
        number: number.replace(/\D/g, ""),
        holderName: holder.trim(),
        expMonth,
        expYear: expYear.length === 2 ? `20${expYear}` : expYear,
        cvv,
      });
      const checkout = await billingApi.createSubscription({ planId, paymentMethod: "card", cardToken });
      await onPaid(checkout.subscription.status === "active");
    } catch (err) {
      if (err instanceof PagBankNotLoadedError) setError("O pagamento com cartão não está disponível agora. Tente o Pix ou tente novamente mais tarde.");
      else if (err instanceof ApiError) setError(err.message || "Pagamento recusado. Confira os dados do cartão.");
      else if (err instanceof Error) setError(err.message);
      else setError("Não foi possível concluir o pagamento com cartão.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid w-full gap-4 sm:grid-cols-2" noValidate>
      {error && (
        <Alert variant="danger" className="sm:col-span-2">
          {error}
        </Alert>
      )}
      <Field label="Número do cartão" htmlFor="payCardNumber" required className="sm:col-span-2">
        <Input id="payCardNumber" inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" value={number} onChange={(e) => setNumber(formatCardNumber(e.target.value))} />
      </Field>
      <Field label="Nome impresso no cartão" htmlFor="payCardHolder" required className="sm:col-span-2">
        <Input id="payCardHolder" autoComplete="cc-name" value={holder} onChange={(e) => setHolder(e.target.value.toUpperCase())} />
      </Field>
      <Field label="Validade (MM/AAAA)" htmlFor="payCardExpiry" required>
        <Input id="payCardExpiry" inputMode="numeric" autoComplete="cc-exp" placeholder="12/2030" value={expiry} onChange={(e) => setExpiry(formatExpiry(e.target.value))} />
      </Field>
      <Field label="CVV" htmlFor="payCardCvv" required>
        <Input id="payCardCvv" inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, ""))} />
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Button type="submit" loading={submitting}>
          <CreditCard className="h-4 w-4" aria-hidden />
          Pagar com cartão de crédito
        </Button>
        <p className="text-xs text-[var(--color-muted)]">Cobrança mensal automática no cartão. Seus dados são enviados com segurança direto ao meio de pagamento.</p>
      </div>
    </form>
  );
}
