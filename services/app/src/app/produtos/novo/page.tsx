"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { ProductForm } from "@/components/features/product-form";
import { catalogApi } from "@/lib/api/catalog";
import { ApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import type { ProductInput } from "@/lib/api/types";
import { useState } from "react";

export default function NewProductPage() {
  const router = useRouter();
  const { notify } = useToast();
  const [limitReached, setLimitReached] = useState(false);

  async function handleSubmit(input: ProductInput) {
    try {
      const product = await catalogApi.createProduct(input);
      notify({ title: "Produto cadastrado", variant: "success" });
      router.push(`/produtos/${product.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setLimitReached(true);
        return;
      }
      throw err;
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Novo produto</h1>
          <p className="text-sm text-[var(--color-muted)]">Cadastre um item no catálogo do seu tenant</p>
        </div>

        {limitReached && (
          <Alert variant="danger" title="Limite do plano atingido">
            Seu plano atingiu o limite de produtos cadastrados. Faça upgrade em Assinatura para continuar.
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Dados do produto</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductForm submitLabel="Cadastrar produto" onSubmit={handleSubmit} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
