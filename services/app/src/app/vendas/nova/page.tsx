"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ProductPicker } from "@/components/features/product-picker";
import { FefoSuggestionPanel } from "@/components/features/fefo-suggestion-panel";
import { useToast } from "@/components/ui/toast";
import { salesApi } from "@/lib/api/sales";
import { stockApi } from "@/lib/api/stock";
import { tenantsApi } from "@/lib/api/tenants";
import { ApiError } from "@/lib/api/client";
import { formatCentsToBRL } from "@/lib/format";
import type { Product } from "@/lib/api/types";

interface SaleRow {
  key: string;
  product: Product | null;
  quantity: string;
  unitPrice: string;
  batchId: string | undefined;
}

function newRow(): SaleRow {
  return { key: crypto.randomUUID(), product: null, quantity: "1", unitPrice: "", batchId: undefined };
}

export default function NewSalePage() {
  const router = useRouter();
  const { notify } = useToast();
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: () => tenantsApi.listStores({ limit: 100 }) });
  const customersQuery = useQuery({ queryKey: ["customers", "picker"], queryFn: () => salesApi.listCustomers({ limit: 100 }) });

  const [storeId, setStoreId] = useState("");
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [paymentMethodLabel, setPaymentMethodLabel] = useState("");
  const [rows, setRows] = useState<SaleRow[]>([{ key: "sale-item-initial", product: null, quantity: "1", unitPrice: "", batchId: undefined }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateRow(key: string, patch: Partial<SaleRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function removeRow(key: string) {
    setRows((r) => (r.length > 1 ? r.filter((row) => row.key !== key) : r));
  }

  const total = rows.reduce((sum, row) => {
    const qty = Number(row.quantity) || 0;
    const price = Math.round((Number(row.unitPrice) || 0) * 100);
    return sum + qty * price;
  }, 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!storeId) {
      setError("Selecione a loja onde a venda está sendo feita.");
      return;
    }
    const items = rows.filter((r) => r.product);
    if (!items.length) {
      setError("Adicione ao menos um item à venda.");
      return;
    }

    setSubmitting(true);
    try {
      const sale = await salesApi.createSale({
        storeId,
        ...(customerId ? { customerId } : {}),
        ...(paymentMethodLabel ? { paymentMethodLabel } : {}),
        items: items.map((r) => ({
          productId: r.product!.id,
          quantity: Number(r.quantity) || 1,
          unitPriceCents: Math.round((Number(r.unitPrice) || 0) * 100),
          ...(r.batchId ? { batchId: r.batchId } : {}),
        })),
      });
      notify({ title: "Venda registrada", variant: "success" });
      router.push(`/vendas/${sale.saleId}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("Estoque insuficiente para um dos itens. Ajuste a quantidade e tente novamente.");
      } else {
        setError("Não foi possível registrar a venda agora.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Nova venda</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Para produtos perecíveis sem lote informado, o sistema aplica a sugestão FEFO automaticamente.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Itens da venda</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
              {error && (
                <Alert variant="danger" title="Não foi possível registrar">
                  {error}
                </Alert>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Loja" htmlFor="storeId" required>
                  <Select
                    id="storeId"
                    value={storeId || undefined}
                    onValueChange={setStoreId}
                    options={(storesQuery.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))}
                    placeholder="Selecione"
                  />
                </Field>
                <Field label="Cliente" htmlFor="customerId" hint="Opcional — venda para consumidor final sem cadastro">
                  <Select
                    id="customerId"
                    value={customerId}
                    onValueChange={setCustomerId}
                    options={(customersQuery.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
                    placeholder="Cliente não identificado"
                  />
                </Field>
                <Field label="Forma de pagamento" htmlFor="paymentMethodLabel" hint="Informativo">
                  <Input id="paymentMethodLabel" placeholder="Ex.: Dinheiro, Pix" value={paymentMethodLabel} onChange={(e) => setPaymentMethodLabel(e.target.value)} />
                </Field>
              </div>

              <div className="flex flex-col gap-3">
                {rows.map((row) => (
                  <SaleItemRow
                    key={row.key}
                    row={row}
                    storeId={storeId}
                    onChange={(patch) => updateRow(row.key, patch)}
                    onRemove={() => removeRow(row.key)}
                  />
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setRows((r) => [...r, newRow()])} className="w-fit">
                  <Plus className="h-4 w-4" />
                  Adicionar item
                </Button>
              </div>

              <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-4">
                <p className="text-sm text-[var(--color-muted)]">Total da venda</p>
                <p className="text-xl font-semibold text-slate-900">{formatCentsToBRL(total)}</p>
              </div>

              <Button type="submit" loading={submitting} className="w-full sm:w-auto sm:self-end">
                Finalizar venda
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function SaleItemRow({
  row,
  storeId,
  onChange,
  onRemove,
}: {
  row: SaleRow;
  storeId: string;
  onChange: (patch: Partial<SaleRow>) => void;
  onRemove: () => void;
}) {
  const [fefoOverridden, setFefoOverridden] = useState(false);

  const fefoQuery = useQuery({
    queryKey: ["fefo", row.product?.id, storeId, row.quantity],
    queryFn: () => stockApi.getFefoSuggestion(row.product!.id, storeId, Number(row.quantity) || 1),
    enabled: Boolean(row.product?.isPerishable && storeId && Number(row.quantity) > 0),
  });

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <ProductPicker
            selected={row.product}
            onSelect={(p) => {
              onChange({
                product: p,
                unitPrice: p.salePriceCents !== undefined ? String(p.salePriceCents / 100) : row.unitPrice,
                batchId: undefined,
              });
              setFefoOverridden(false);
            }}
            onClear={() => onChange({ product: null, batchId: undefined })}
          />
        </div>
        <Field label="Qtd." htmlFor={`qty-${row.key}`} className="w-20">
          <Input id={`qty-${row.key}`} type="number" min={1} value={row.quantity} onChange={(e) => onChange({ quantity: e.target.value })} />
        </Field>
        <Field label="Preço unit. (R$)" htmlFor={`price-${row.key}`} className="w-28">
          <Input id={`price-${row.key}`} type="number" min={0} step="0.01" value={row.unitPrice} onChange={(e) => onChange({ unitPrice: e.target.value })} />
        </Field>
        <Button type="button" variant="ghost" size="icon" aria-label="Remover item" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {row.product?.isPerishable && storeId && (
        <div>
          {fefoQuery.isLoading ? (
            <p className="text-xs text-[var(--color-muted)]">Calculando sugestão FEFO…</p>
          ) : fefoQuery.data ? (
            <FefoSuggestionPanel
              suggestion={fefoQuery.data}
              overridden={fefoOverridden}
              onAccept={() => {
                setFefoOverridden(false);
                onChange({ batchId: fefoQuery.data.suggestions[0]?.batchId });
              }}
              onOverride={() => setFefoOverridden(true)}
            />
          ) : null}

          {fefoOverridden && fefoQuery.data && fefoQuery.data.suggestions.length > 1 && (
            <Field label="Escolher lote manualmente" htmlFor={`batch-${row.key}`} className="mt-2">
              <Select
                id={`batch-${row.key}`}
                value={row.batchId}
                onValueChange={(v) => onChange({ batchId: v })}
                options={fefoQuery.data.suggestions.map((s) => ({
                  value: s.batchId,
                  label: `Lote vencendo em ${s.expiryDate} (${s.quantity} un.)`,
                }))}
                placeholder="Selecione o lote"
              />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}
