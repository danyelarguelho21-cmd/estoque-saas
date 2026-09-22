"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ProductPicker } from "@/components/features/product-picker";
import { FefoSuggestionPanel } from "@/components/features/fefo-suggestion-panel";
import { useToast } from "@/components/ui/toast";
import { stockApi } from "@/lib/api/stock";
import { tenantsApi } from "@/lib/api/tenants";
import type { FefoSuggestion, Product } from "@/lib/api/types";

const EXIT_TYPES = [
  { value: "saida_perda", label: "Perda / quebra / vencimento" },
  { value: "ajuste", label: "Ajuste de inventário" },
];

export default function StockExitPage() {
  const router = useRouter();
  const { notify } = useToast();
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: () => tenantsApi.listStores({ limit: 100 }) });

  const [product, setProduct] = useState<Product | null>(null);
  const [storeId, setStoreId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [type, setType] = useState<"saida_perda" | "ajuste">("saida_perda");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [fefoOverridden, setFefoOverridden] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | undefined>(undefined);

  const fefoQuery = useQuery({
    queryKey: ["fefo", product?.id, storeId, quantity],
    queryFn: () => stockApi.getFefoSuggestion(product!.id, storeId, Number(quantity) || 1),
    enabled: Boolean(product?.isPerishable && storeId && Number(quantity) > 0),
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!product || !storeId) {
      setError("Selecione o produto e a loja.");
      return;
    }
    if (type === "saida_perda" && !reason.trim()) {
      setError("Informe o motivo — obrigatório para saída por perda/quebra.");
      return;
    }
    setSubmitting(true);
    try {
      await stockApi.createExit({
        productId: product.id,
        storeId,
        quantity: Number(quantity) || 1,
        type,
        reason: reason.trim(),
        ...(selectedBatchId ? { batchId: selectedBatchId } : {}),
      });
      notify({ title: "Saída registrada", variant: "success" });
      router.push("/estoque");
    } catch {
      setError("Não foi possível registrar a saída. Verifique o saldo disponível.");
    } finally {
      setSubmitting(false);
    }
  }

  function fefoAsAccepted(suggestion: FefoSuggestion) {
    setFefoOverridden(false);
    setSelectedBatchId(suggestion.suggestions[0]?.batchId);
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Saída de estoque</h1>
          <p className="text-sm text-[var(--color-muted)]">Perda, quebra, vencimento ou ajuste de inventário</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Dados da saída</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              {error && (
                <Alert variant="danger" title="Não foi possível registrar">
                  {error}
                </Alert>
              )}

              <Field label="Produto" htmlFor="product-picker" required>
                <ProductPicker
                  id="product-picker"
                  selected={product}
                  onSelect={(p) => {
                    setProduct(p);
                    setSelectedBatchId(undefined);
                    setFefoOverridden(false);
                  }}
                  onClear={() => setProduct(null)}
                />
              </Field>

              <Field label="Loja/depósito" htmlFor="storeId" required>
                <Select
                  id="storeId"
                  value={storeId || undefined}
                  onValueChange={setStoreId}
                  options={(storesQuery.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))}
                  placeholder="Selecione a loja"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tipo de saída" htmlFor="type" required>
                  <Select id="type" value={type} onValueChange={(v) => setType(v as "saida_perda" | "ajuste")} options={EXIT_TYPES} />
                </Field>
                <Field label="Quantidade" htmlFor="quantity" required>
                  <Input id="quantity" type="number" min={1} required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </Field>
              </div>

              <Field label="Motivo" htmlFor="reason" required={type === "saida_perda"} hint={type === "ajuste" ? "Opcional para ajustes" : undefined}>
                <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: produto danificado no transporte" />
              </Field>

              {product?.isPerishable && storeId && (
                <div>
                  {fefoQuery.isLoading ? (
                    <p className="text-sm text-[var(--color-muted)]">Calculando sugestão FEFO…</p>
                  ) : fefoQuery.data ? (
                    <FefoSuggestionPanel
                      suggestion={fefoQuery.data}
                      overridden={fefoOverridden}
                      onAccept={() => fefoAsAccepted(fefoQuery.data)}
                      onOverride={() => setFefoOverridden(true)}
                    />
                  ) : null}

                  {fefoOverridden && fefoQuery.data && fefoQuery.data.suggestions.length > 1 && (
                    <Field label="Escolher lote manualmente" htmlFor="batchId" className="mt-3" hint="A saída registra que a sugestão FEFO foi sobreposta">
                      <Select
                        id="batchId"
                        value={selectedBatchId}
                        onValueChange={setSelectedBatchId}
                        options={fefoQuery.data.suggestions.map((s) => ({
                          value: s.batchId,
                          label: `Lote vencendo em ${s.expiryDate} (${s.quantity} un. disponíveis)`,
                        }))}
                        placeholder="Selecione o lote"
                      />
                    </Field>
                  )}
                </div>
              )}

              <Button type="submit" loading={submitting} className="w-full sm:w-auto sm:self-end">
                Registrar saída
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
