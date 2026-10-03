"use client";

import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { BRAZIL_UFS, lookupCep, onlyDigits, zipcodeMask, type BillingAddressInput } from "@/lib/billing-address";

export type BillingAddressErrors = Partial<Record<keyof BillingAddressInput, string>>;

interface BillingAddressFieldsProps {
  value: BillingAddressInput;
  onChange: (value: BillingAddressInput) => void;
  errors?: BillingAddressErrors;
  idPrefix?: string;
}

const UF_OPTIONS = BRAZIL_UFS.map((uf) => ({ value: uf, label: uf }));

/**
 * Campos de endereço de cobrança (exigido pelo Pix da Vindi). Ao completar 8 dígitos de CEP,
 * preenche rua/bairro/cidade/UF via ViaCEP; se a consulta falhar, os campos continuam editáveis.
 */
export function BillingAddressFields({ value, onChange, errors = {}, idPrefix = "billing" }: BillingAddressFieldsProps) {
  const [cepStatus, setCepStatus] = useState<"idle" | "loading" | "not_found">("idle");
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const lookupController = useRef<AbortController | null>(null);
  useEffect(() => () => lookupController.current?.abort(), []);

  function set<K extends keyof BillingAddressInput>(key: K, fieldValue: BillingAddressInput[K]) {
    const next = { ...latest.current, [key]: fieldValue };
    latest.current = next;
    onChange(next);
  }

  async function handleZipcodeChange(raw: string) {
    const masked = zipcodeMask(raw);
    set("zipcode", masked);
    lookupController.current?.abort();
    const digits = onlyDigits(masked);
    if (digits.length !== 8) {
      setCepStatus("idle");
      return;
    }
    const controller = new AbortController();
    lookupController.current = controller;
    setCepStatus("loading");
    const result = await lookupCep(digits, controller.signal);
    if (controller.signal.aborted) return;
    if (!result) {
      setCepStatus("not_found");
      return;
    }
    setCepStatus("idle");
    // Só sobrescreve com o que o ViaCEP devolveu preenchido (CEP geral de cidade vem sem rua/bairro).
    const current = latest.current;
    const next: BillingAddressInput = {
      ...current,
      street: result.street || current.street,
      neighborhood: result.neighborhood || current.neighborhood,
      city: result.city || current.city,
      state: result.state || current.state,
    };
    latest.current = next;
    onChange(next);
  }

  const id = (name: string) => `${idPrefix}-${name}`;
  const zipcodeHint =
    cepStatus === "loading"
      ? "Buscando endereço…"
      : cepStatus === "not_found"
        ? "Não encontramos este CEP — preencha o endereço manualmente."
        : undefined;

  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <Field label="CEP" htmlFor={id("zipcode")} required error={errors.zipcode} hint={zipcodeHint} className="sm:col-span-2">
        <Input
          id={id("zipcode")}
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="00000-000"
          required
          value={value.zipcode}
          onChange={(e) => void handleZipcodeChange(e.target.value)}
        />
      </Field>
      <Field label="Rua" htmlFor={id("street")} required error={errors.street} className="sm:col-span-4">
        <Input id={id("street")} autoComplete="address-line1" required value={value.street} onChange={(e) => set("street", e.target.value)} />
      </Field>
      <Field label="Número" htmlFor={id("number")} required error={errors.number} className="sm:col-span-2">
        <Input id={id("number")} required value={value.number} onChange={(e) => set("number", e.target.value)} />
      </Field>
      <Field label="Complemento" htmlFor={id("complement")} error={errors.complement} className="sm:col-span-4">
        <Input id={id("complement")} autoComplete="address-line2" value={value.complement ?? ""} onChange={(e) => set("complement", e.target.value)} />
      </Field>
      <Field label="Bairro" htmlFor={id("neighborhood")} error={errors.neighborhood} className="sm:col-span-2">
        <Input id={id("neighborhood")} value={value.neighborhood ?? ""} onChange={(e) => set("neighborhood", e.target.value)} />
      </Field>
      <Field label="Cidade" htmlFor={id("city")} required error={errors.city} className="sm:col-span-3">
        <Input id={id("city")} autoComplete="address-level2" required value={value.city} onChange={(e) => set("city", e.target.value)} />
      </Field>
      <Field label="UF" htmlFor={id("state")} required error={errors.state} className="sm:col-span-1">
        <Select
          id={id("state")}
          aria-label="UF"
          placeholder="UF"
          options={UF_OPTIONS}
          value={value.state || undefined}
          invalid={Boolean(errors.state)}
          onValueChange={(uf) => set("state", uf)}
        />
      </Field>
    </div>
  );
}
