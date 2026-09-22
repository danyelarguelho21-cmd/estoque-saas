"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ProductPicker } from "@/components/features/product-picker";
import { useToast } from "@/components/ui/toast";
import { stockApi } from "@/lib/api/stock";
import { tenantsApi } from "@/lib/api/tenants";
import type { Product } from "@/lib/api/types";

export default function ManualEntryPage() {
  const router = useRouter();
  const { notify } = useToast();
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: () => tenantsApi.listStores({ limit: 100 }) });
  const tenantQuery = useQuery({ queryKey: ["tenant"], queryFn: tenantsApi.getTenant });

  const [product, setProduct] = useState<Product | null>(null);
  const [storeId, setStoreId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const showBatchFields = Boolean(product?.isPerishable && tenantQuery.data?.perishableTrackingEnabled);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!product || !storeId) {
      setError("Selecione o produto e a loja de destino.");
      return;
    }
    setSubmitting(true);
    try {
      await stockApi.createManualEntry({
        productId: product.id,
        storeId,
        quantity: Number(quantity) || 1,
        ...(unitCost ? { unitCostCents: Math.round(Number(unitCost) * 100) } : {}),
        ...(showBatchFields && batchNumber ? { batchNumber } : {}),
        ...(showBatchFields && expiryDate ? { expiryDate } : {}),
      });
      notify({ title: "Entrada registrada", variant: "success" });
      router.push("/estoque");
    } catch {
      setError("Não foi possível registrar a entrada. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Entrada manual de estoque</h1>
          <p className="text-sm text-[var(--color-muted)]">Registre a entrada de produtos sem NF-e</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Dados da entrada</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              {error && (
                <Alert variant="danger" title="Não foi possível registrar">
                  {error}
                </Alert>
              )}

              <Field label="Produto" htmlFor="product-picker" required>
                <ProductPicker id="product-picker" selected={product} onSelect={setProduct} onClear={() => setProduct(null)} />
              </Field>

              <Field label="Loja/depósito de destino" htmlFor="storeId" required>
                <Select
                  id="storeId"
                  value={storeId || undefined}
                  onValueChange={setStoreId}
                  options={(storesQuery.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))}
                  placeholder="Selecione a loja"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Quantidade" htmlFor="quantity" required>
                  <Input id="quantity" type="number" min={1} required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </Field>
                <Field label="Custo unitário (R$)" htmlFor="unitCost">
                  <Input id="unitCost" type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
                </Field>
              </div>

              {showBatchFields && (
                <div className="grid gap-4 rounded-md border border-[var(--color-border)] bg-slate-50 p-4 sm:grid-cols-2">
                  <Field label="Número do lote" htmlFor="batchNumber" hint="Produto perecível — controle de lote ativo">
                    <Input id="batchNumber" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
                  </Field>
                  <Field label="Data de validade" htmlFor="expiryDate">
                    <Input id="expiryDate" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                  </Field>
                </div>
              )}

              <Button type="submit" loading={submitting} className="w-full sm:w-auto sm:self-end">
                Registrar entrada
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
