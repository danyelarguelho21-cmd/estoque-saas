"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
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
import { useToast } from "@/components/ui/toast";
import { stockApi } from "@/lib/api/stock";
import { tenantsApi } from "@/lib/api/tenants";
import type { Product } from "@/lib/api/types";

interface TransferRow {
  key: string;
  product: Product | null;
  quantity: string;
}

export default function TransferPage() {
  const router = useRouter();
  const { notify } = useToast();
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: () => tenantsApi.listStores({ limit: 100 }) });

  const [originStoreId, setOriginStoreId] = useState("");
  const [destinationStoreId, setDestinationStoreId] = useState("");
  const [rows, setRows] = useState<TransferRow[]>([{ key: crypto.randomUUID(), product: null, quantity: "1" }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function addRow() {
    setRows((r) => [...r, { key: crypto.randomUUID(), product: null, quantity: "1" }]);
  }
  function removeRow(key: string) {
    setRows((r) => (r.length > 1 ? r.filter((row) => row.key !== key) : r));
  }
  function updateRow(key: string, patch: Partial<TransferRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!originStoreId || !destinationStoreId) {
      setError("Selecione a loja de origem e de destino.");
      return;
    }
    if (originStoreId === destinationStoreId) {
      setError("A origem e o destino precisam ser lojas diferentes.");
      return;
    }
    const items = rows.filter((r) => r.product);
    if (!items.length) {
      setError("Adicione ao menos um produto à transferência.");
      return;
    }

    setSubmitting(true);
    try {
      await stockApi.createTransfer({
        originStoreId,
        destinationStoreId,
        items: items.map((r) => ({ productId: r.product!.id, quantity: Number(r.quantity) || 1 })),
      });
      notify({ title: "Transferência registrada", variant: "success" });
      router.push("/estoque");
    } catch {
      setError("Não foi possível registrar a transferência. Verifique o saldo na loja de origem.");
    } finally {
      setSubmitting(false);
    }
  }

  const storeOptions = (storesQuery.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }));

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Transferência entre lojas</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Débito na origem e crédito no destino em uma única operação. Ver{" "}
            <Link href="/estoque" className="text-[var(--color-primary)] hover:underline">
              histórico completo
            </Link>
            .
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Dados da transferência</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              {error && (
                <Alert variant="danger" title="Não foi possível registrar">
                  {error}
                </Alert>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Loja de origem" htmlFor="originStoreId" required>
                  <Select id="originStoreId" value={originStoreId || undefined} onValueChange={setOriginStoreId} options={storeOptions} placeholder="Selecione" />
                </Field>
                <Field label="Loja de destino" htmlFor="destinationStoreId" required>
                  <Select id="destinationStoreId" value={destinationStoreId || undefined} onValueChange={setDestinationStoreId} options={storeOptions} placeholder="Selecione" />
                </Field>
              </div>

              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium text-slate-900">Produtos</p>
                {rows.map((row) => (
                  <div key={row.key} className="flex items-end gap-2">
                    <div className="flex-1">
                      <ProductPicker
                        selected={row.product}
                        onSelect={(p) => updateRow(row.key, { product: p })}
                        onClear={() => updateRow(row.key, { product: null })}
                      />
                    </div>
                    <Input
                      type="number"
                      min={1}
                      className="w-24"
                      aria-label="Quantidade"
                      value={row.quantity}
                      onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                    />
                    <Button type="button" variant="ghost" size="icon" aria-label="Remover item" onClick={() => removeRow(row.key)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addRow} className="w-fit">
                  <Plus className="h-4 w-4" />
                  Adicionar produto
                </Button>
              </div>

              <Button type="submit" loading={submitting} className="w-full sm:w-auto sm:self-end">
                Registrar transferência
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
