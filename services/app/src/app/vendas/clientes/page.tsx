"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewCustomerDialog } from "@/components/features/new-customer-dialog";
import { salesApi } from "@/lib/api/sales";

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const customersQuery = useQuery({
    queryKey: ["customers", search],
    queryFn: () => salesApi.listCustomers({ search: search || undefined, limit: 50 }),
  });

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Clientes</h1>
            <p className="text-sm text-[var(--color-muted)]">Cadastro e histórico de compras</p>
          </div>
          <NewCustomerDialog />
        </div>

        <Card>
          <div className="border-b border-[var(--color-border)] p-4">
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input placeholder="Buscar cliente" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          {customersQuery.isLoading ? (
            <PageSpinner />
          ) : !customersQuery.data?.items.length ? (
            <CardContent>
              <EmptyState title="Nenhum cliente cadastrado" />
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>E-mail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customersQuery.data.items.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <Link href={`/vendas/clientes/${customer.id}`} className="text-[var(--color-primary)] hover:underline">
                        {customer.name}
                      </Link>
                    </TableCell>
                    <TableCell>{customer.document ?? "—"}</TableCell>
                    <TableCell>{customer.phone ?? "—"}</TableCell>
                    <TableCell>{customer.email ?? "—"}</TableCell>
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
