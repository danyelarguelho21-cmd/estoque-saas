"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { PageSpinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { RoleGate } from "@/components/features/role-gate";
import { ProductForm } from "@/components/features/product-form";
import { useToast } from "@/components/ui/toast";
import { catalogApi } from "@/lib/api/catalog";
import { tenantsApi } from "@/lib/api/tenants";
import type { ProductInput } from "@/lib/api/types";

export default function ProductDetailPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = use(params);
  const router = useRouter();
  const { notify } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const productQuery = useQuery({
    queryKey: ["product", productId],
    queryFn: () => catalogApi.getProduct(productId),
  });
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: () => tenantsApi.listStores({ limit: 100 }) });
  const settingsQuery = useQuery({
    queryKey: ["product", productId, "store-settings"],
    queryFn: () => catalogApi.listProductStoreSettings(productId),
  });
  const queryClient = useQueryClient();
  const stores = storesQuery.data?.items ?? [];

  // Mínimos por loja: o salvo no servidor + o que o usuário editou ("" = usa o mínimo geral).
  const savedMins: Record<string, string> = Object.fromEntries(
    (settingsQuery.data ?? []).map((s) => [s.storeId, s.minStockOverride === null ? "" : String(s.minStockOverride)]),
  );
  const [storeEdits, setStoreEdits] = useState<Record<string, string>>({});
  const storeMins: Record<string, string> = { ...savedMins, ...storeEdits };

  async function handleUpdate(input: ProductInput) {
    await catalogApi.updateProduct(productId, input);

    if (stores.length > 1) {
      const saved = new Map((settingsQuery.data ?? []).map((s) => [s.storeId, s.minStockOverride]));
      for (const store of stores) {
        const raw = (storeMins[store.id] ?? "").trim();
        const next = raw === "" ? null : Math.max(0, Math.round(Number(raw) || 0));
        if ((saved.get(store.id) ?? null) !== next) {
          await catalogApi.setProductStoreMinStock(productId, store.id, next);
        }
      }
    }

    // Atualiza alertas/listas na hora (sem esperar o cache expirar).
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["product", productId] }),
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["alerts"] }),
    ]);
    setStoreEdits({});
    notify({ title: "Produto atualizado", variant: "success" });
  }

  async function handleDelete() {
    await catalogApi.deleteProduct(productId);
    notify({ title: "Produto removido", variant: "info" });
    router.push("/produtos");
  }

  if (productQuery.isLoading) {
    return (
      <AppShell>
        <PageSpinner />
      </AppShell>
    );
  }

  if (!productQuery.data) {
    return (
      <AppShell>
        <EmptyState title="Produto não encontrado" description="Ele pode ter sido removido." />
      </AppShell>
    );
  }

  const product = productQuery.data;

  return (
    <AppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{product.name}</h1>
            {product.sku && <p className="text-sm text-[var(--color-muted)]">SKU {product.sku}</p>}
          </div>
          <RoleGate permission="catalog:manage">
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger asChild>
                <Button variant="danger">
                  <Trash2 className="h-4 w-4" />
                  Remover
                </Button>
              </DialogTrigger>
              <DialogContent title="Remover produto" description="Essa ação não pode ser desfeita.">
                <p className="text-sm text-slate-600">
                  Tem certeza que deseja remover <strong>{product.name}</strong> do catálogo? O histórico de
                  movimentações é preservado para auditoria.
                </p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                    Cancelar
                  </Button>
                  <Button variant="danger" onClick={handleDelete}>
                    Remover produto
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </RoleGate>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Editar produto</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductForm
              submitLabel="Salvar alterações"
              initial={{
                sku: product.sku ?? "",
                name: product.name,
                ...(product.categoryId ? { categoryId: product.categoryId } : {}),
                unitOfMeasure: product.unitOfMeasure,
                ...(product.barcode ? { barcode: product.barcode } : {}),
                ...(product.supplierId ? { supplierId: product.supplierId } : {}),
                isPerishable: product.isPerishable ?? false,
                minStockGlobal: product.minStockGlobal ?? 0,
                ...(product.costPriceCents !== undefined ? { costPriceCents: product.costPriceCents } : {}),
                ...(product.salePriceCents !== undefined ? { salePriceCents: product.salePriceCents } : {}),
              }}
              onSubmit={handleUpdate}
            >
              {stores.length > 1 && (
                <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Estoque mínimo por loja (opcional)</p>
                    <p className="text-xs text-[var(--color-muted)]">
                      Deixe em branco para usar o mínimo geral acima. Preencha só se alguma loja precisar de um mínimo diferente.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {stores.map((store) => (
                      <Field key={store.id} label={store.name} htmlFor={`min-${store.id}`}>
                        <Input
                          id={`min-${store.id}`}
                          type="number"
                          min={0}
                          placeholder="Usa o mínimo geral"
                          value={storeMins[store.id] ?? ""}
                          onChange={(e) => setStoreEdits((prev) => ({ ...prev, [store.id]: e.target.value }))}
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              )}
            </ProductForm>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
