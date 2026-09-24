"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  async function handleUpdate(input: ProductInput) {
    await catalogApi.updateProduct(productId, input);
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

        <Tabs defaultValue="geral">
          <TabsList>
            <TabsTrigger value="geral">Dados gerais</TabsTrigger>
            <TabsTrigger value="minimo">Estoque mínimo por loja</TabsTrigger>
          </TabsList>

          <TabsContent value="geral">
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
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="minimo">
            <Card>
              <CardHeader>
                <CardTitle>Estoque mínimo por loja</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-[var(--color-muted)]">
                  Sobrepõe o mínimo global ({product.minStockGlobal ?? 0}) apenas para a loja selecionada.
                </p>
                {storesQuery.data?.items.length ? (
                  storesQuery.data.items.map((store) => (
                    <StoreMinStockRow key={store.id} productId={productId} storeName={store.name} storeId={store.id} />
                  ))
                ) : (
                  <EmptyState title="Nenhuma loja cadastrada" description="Cadastre lojas em Usuários e lojas." />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function StoreMinStockRow({ productId, storeId, storeName }: { productId: string; storeId: string; storeName: string }) {
  const { notify } = useToast();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await catalogApi.setProductStoreMinStock(productId, storeId, Number(value) || 0);
      notify({ title: `Mínimo atualizado para ${storeName}`, variant: "success" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-end gap-3">
      <Field label={storeName} htmlFor={`min-${storeId}`} className="flex-1">
        <Input id={`min-${storeId}`} type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Button variant="outline" size="sm" loading={saving} onClick={handleSave}>
        Salvar
      </Button>
    </div>
  );
}
