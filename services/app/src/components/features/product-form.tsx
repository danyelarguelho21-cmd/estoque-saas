"use client";

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { catalogApi } from "@/lib/api/catalog";
import { RoleGate } from "@/components/features/role-gate";
import type { ProductInput } from "@/lib/api/types";

interface ProductFormProps {
  initial?: Partial<ProductInput>;
  submitLabel: string;
  onSubmit: (input: ProductInput) => Promise<void>;
}

const UNITS = ["UN", "KG", "L", "CX", "PCT", "DZ"].map((u) => ({ value: u, label: u }));

export function ProductForm({ initial, submitLabel, onSubmit }: ProductFormProps) {
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: catalogApi.listCategories });
  const suppliersQuery = useQuery({
    queryKey: ["suppliers", "form"],
    queryFn: () => catalogApi.listSuppliers({ limit: 100 }),
  });

  const [sku, setSku] = useState(initial?.sku ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [unitOfMeasure, setUnitOfMeasure] = useState(initial?.unitOfMeasure ?? "UN");
  const [barcode, setBarcode] = useState(initial?.barcode ?? "");
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [isPerishable, setIsPerishable] = useState(initial?.isPerishable ?? false);
  const [minStockGlobal, setMinStockGlobal] = useState(String(initial?.minStockGlobal ?? 0));
  const [costPrice, setCostPrice] = useState(
    initial?.costPriceCents !== undefined ? String(initial.costPriceCents / 100) : "",
  );
  const [salePrice, setSalePrice] = useState(
    initial?.salePriceCents !== undefined ? String(initial.salePriceCents / 100) : "",
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const input: ProductInput = {
        name,
        unitOfMeasure,
        isPerishable,
        minStockGlobal: Number(minStockGlobal) || 0,
      };
      if (sku.trim()) input.sku = sku.trim();
      if (categoryId) input.categoryId = categoryId;
      if (barcode) input.barcode = barcode;
      if (supplierId) input.supplierId = supplierId;
      if (costPrice) input.costPriceCents = Math.round(Number(costPrice) * 100);
      if (salePrice) input.salePriceCents = Math.round(Number(salePrice) * 100);

      await onSubmit(input);
    } catch {
      setError("Não foi possível salvar o produto. Verifique os dados e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SKU" htmlFor="sku" hint="Opcional">
          <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} />
        </Field>
        <Field label="Nome do produto" htmlFor="name" required>
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Categoria" htmlFor="categoryId">
          <Select
            id="categoryId"
            value={categoryId || undefined}
            onValueChange={setCategoryId}
            options={(categoriesQuery.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Sem categoria"
          />
        </Field>
        <Field label="Unidade de medida" htmlFor="unitOfMeasure" required>
          <Select id="unitOfMeasure" value={unitOfMeasure} onValueChange={setUnitOfMeasure} options={UNITS} />
        </Field>
        <Field label="Código de barras" htmlFor="barcode">
          <Input id="barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        </Field>
        <Field label="Fornecedor" htmlFor="supplierId">
          <Select
            id="supplierId"
            value={supplierId || undefined}
            onValueChange={setSupplierId}
            options={(suppliersQuery.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))}
            placeholder="Sem fornecedor"
          />
        </Field>
        <Field label="Estoque mínimo (global)" htmlFor="minStockGlobal" hint="Pode ser sobreposto por loja">
          <Input
            id="minStockGlobal"
            type="number"
            min={0}
            value={minStockGlobal}
            onChange={(e) => setMinStockGlobal(e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-3 pt-6">
          <Switch id="isPerishable" checked={isPerishable} onCheckedChange={setIsPerishable} />
          <label htmlFor="isPerishable" className="text-sm text-slate-700">
            Produto perecível (controle de lote e validade)
          </label>
        </div>

        <RoleGate permission="catalog:view-cost">
          <Field label="Custo (R$)" htmlFor="costPrice" hint="Visível apenas para admin/operador">
            <Input id="costPrice" type="number" min={0} step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
          </Field>
        </RoleGate>
        <Field label="Preço de venda (R$)" htmlFor="salePrice">
          <Input id="salePrice" type="number" min={0} step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
        </Field>
      </div>

      <Button type="submit" loading={submitting} className="w-full sm:w-auto sm:self-end">
        {submitLabel}
      </Button>
    </form>
  );
}
