"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RoleGate } from "@/components/features/role-gate";
import { useToast } from "@/components/ui/toast";
import { catalogApi } from "@/lib/api/catalog";

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: catalogApi.listCategories });

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await catalogApi.createCategory(name.trim());
      setName("");
      notify({ title: "Categoria criada", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Categorias</h1>
          <p className="text-sm text-[var(--color-muted)]">Organize seus produtos por categoria</p>
        </div>

        <RoleGate permission="catalog:manage">
          <Card>
            <CardHeader>
              <CardTitle>Nova categoria</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="flex gap-2">
                <Input
                  aria-label="Nome da categoria"
                  placeholder="Ex.: Bebidas, Limpeza, Higiene"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Button type="submit" loading={submitting}>
                  <Plus className="h-4 w-4" />
                  Adicionar
                </Button>
              </form>
            </CardContent>
          </Card>
        </RoleGate>

        <Card>
          {categoriesQuery.isLoading ? (
            <PageSpinner />
          ) : !categoriesQuery.data?.length ? (
            <CardContent>
              <EmptyState title="Nenhuma categoria cadastrada" />
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoriesQuery.data.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>{category.name}</TableCell>
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
