"use client";

import { useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { catalogApi } from "@/lib/api/catalog";
import type { NfeImportItem } from "@/lib/api/types";

interface NfeQuickCreateDialogProps {
  item: NfeImportItem;
  onCreated: () => void;
}

/**
 * Cadastro rápido de produto a partir de um item não reconhecido do XML (ADR-005) — sem sair
 * da tela de conferência. O SKU/nome/código de barras vêm pré-preenchidos do XML.
 */
export function NfeQuickCreateDialog({ item, onCreated }: NfeQuickCreateDialogProps) {
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState(item.cProd);
  const [name, setName] = useState(item.xProd);
  const [barcode, setBarcode] = useState(item.cEAN ?? "");
  const [unitOfMeasure, setUnitOfMeasure] = useState("UN");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await catalogApi.createProduct({
        sku,
        name,
        unitOfMeasure,
        ...(barcode ? { barcode } : {}),
      });
      setOpen(false);
      onCreated();
    } catch {
      setError("Não foi possível cadastrar o produto. Verifique se o SKU já existe.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          Cadastrar produto
        </Button>
      </DialogTrigger>
      <DialogContent title="Cadastro rápido" description={`Item do XML: ${item.xProd}`}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {error && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
          <Field label="SKU" htmlFor={`sku-${item.id}`} required>
            <Input id={`sku-${item.id}`} required value={sku} onChange={(e) => setSku(e.target.value)} />
          </Field>
          <Field label="Nome do produto" htmlFor={`name-${item.id}`} required>
            <Input id={`name-${item.id}`} required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Código de barras" htmlFor={`barcode-${item.id}`}>
            <Input id={`barcode-${item.id}`} value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </Field>
          <Field label="Unidade de medida" htmlFor={`unit-${item.id}`} required>
            <Input id={`unit-${item.id}`} required value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Cadastrar e vincular
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
