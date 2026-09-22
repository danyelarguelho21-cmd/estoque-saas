"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
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

function NewCustomerDialog() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await salesApi.createCustomer({
        name,
        ...(document ? { document } : {}),
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
      });
      notify({ title: "Cliente cadastrado", variant: "success" });
      setOpen(false);
      setName("");
      setDocument("");
      setPhone("");
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Novo cliente
        </Button>
      </DialogTrigger>
      <DialogContent title="Novo cliente">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Field label="Nome" htmlFor="customerName" required>
            <Input id="customerName" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Documento (CPF/CNPJ)" htmlFor="customerDocument">
            <Input id="customerDocument" value={document} onChange={(e) => setDocument(e.target.value)} />
          </Field>
          <Field label="Telefone" htmlFor="customerPhone">
            <Input id="customerPhone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="E-mail" htmlFor="customerEmail">
            <Input id="customerEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Cadastrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
