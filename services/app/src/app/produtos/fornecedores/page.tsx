"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RoleGate } from "@/components/features/role-gate";
import { useToast } from "@/components/ui/toast";
import { catalogApi } from "@/lib/api/catalog";
import { cnpjMask } from "@/lib/format";

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const suppliersQuery = useQuery({ queryKey: ["suppliers"], queryFn: () => catalogApi.listSuppliers({ limit: 50 }) });

  const [name, setName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const input: { name: string; cnpj?: string; contact?: string } = { name: name.trim() };
      if (cnpj) input.cnpj = cnpj;
      if (contact) input.contact = contact;
      await catalogApi.createSupplier(input);
      setName("");
      setCnpj("");
      setContact("");
      notify({ title: "Fornecedor cadastrado", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Fornecedores</h1>
          <p className="text-sm text-[var(--color-muted)]">Usados em entradas de estoque e importação de NF-e</p>
        </div>

        <RoleGate permission="catalog:manage">
          <Card>
            <CardHeader>
              <CardTitle>Novo fornecedor</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-3">
                <Field label="Nome" htmlFor="supplierName" required>
                  <Input id="supplierName" required value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="CNPJ" htmlFor="supplierCnpj">
                  <Input id="supplierCnpj" value={cnpj} onChange={(e) => setCnpj(cnpjMask(e.target.value))} />
                </Field>
                <Field label="Contato" htmlFor="supplierContact">
                  <Input id="supplierContact" value={contact} onChange={(e) => setContact(e.target.value)} />
                </Field>
                <Button type="submit" loading={submitting} className="sm:col-span-3 sm:w-fit">
                  <Plus className="h-4 w-4" />
                  Adicionar fornecedor
                </Button>
              </form>
            </CardContent>
          </Card>
        </RoleGate>

        <Card>
          {suppliersQuery.isLoading ? (
            <PageSpinner />
          ) : !suppliersQuery.data?.items.length ? (
            <CardContent>
              <EmptyState title="Nenhum fornecedor cadastrado" />
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Contato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliersQuery.data.items.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell>{supplier.name}</TableCell>
                    <TableCell>{supplier.cnpj ?? "—"}</TableCell>
                    <TableCell>{supplier.contact ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
