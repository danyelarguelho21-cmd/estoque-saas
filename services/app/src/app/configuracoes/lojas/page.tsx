"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { RoleGate } from "@/components/features/role-gate";
import { PlanLimitBanner } from "@/components/features/plan-limit-banner";
import { useToast } from "@/components/ui/toast";
import { tenantsApi } from "@/lib/api/tenants";
import { ApiError } from "@/lib/api/client";
import { ConfigTabs } from "@/components/layout/config-tabs";
import { usePlanLimits } from "@/hooks/use-plan-limits";

const STORE_TYPES = [
  { value: "loja", label: "Loja" },
  { value: "deposito", label: "Depósito" },
];

export default function StoresSettingsPage() {
  return (
    <AppShell>
      <RoleGate permission="stores:manage" fallback={<EmptyState title="Acesso restrito" description="Apenas administradores podem gerenciar lojas." />}>
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Usuários e lojas</h1>
            <p className="text-sm text-[var(--color-muted)]">Gerencie lojas/depósitos, usuários e papéis do seu tenant</p>
          </div>
          <ConfigTabs active="lojas" />
          <StoresPanel />
        </div>
      </RoleGate>
    </AppShell>
  );
}

function StoresPanel() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: () => tenantsApi.listStores({ limit: 100 }) });
  const { plan } = usePlanLimits();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"loja" | "deposito">("loja");
  const [address, setAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [limitError, setLimitError] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setLimitError(false);
    try {
      await tenantsApi.createStore({ name, type, ...(address ? { address } : {}) });
      notify({ title: "Loja cadastrada", variant: "success" });
      setOpen(false);
      setName("");
      setAddress("");
      await queryClient.invalidateQueries({ queryKey: ["stores"] });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setLimitError(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {plan && storesQuery.data && !storesQuery.data.page.has_more && (
        <PlanLimitBanner resourceLabel="lojas/depósitos" current={storesQuery.data.items.length} max={plan.maxStores} />
      )}
      <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Lojas e depósitos</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Nova loja
            </Button>
          </DialogTrigger>
          <DialogContent title="Nova loja/depósito">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              {limitError && (
                <p role="alert" className="text-sm text-[var(--color-danger)]">
                  Limite de lojas do plano atingido. Faça upgrade em Assinatura.
                </p>
              )}
              <Field label="Nome" htmlFor="storeName" required>
                <Input id="storeName" required value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Tipo" htmlFor="storeType" required>
                <Select id="storeType" value={type} onValueChange={(v) => setType(v as "loja" | "deposito")} options={STORE_TYPES} />
              </Field>
              <Field label="Endereço" htmlFor="storeAddress">
                <Input id="storeAddress" value={address} onChange={(e) => setAddress(e.target.value)} />
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
      </CardHeader>
      {storesQuery.isLoading ? (
        <PageSpinner />
      ) : !storesQuery.data?.items.length ? (
        <CardContent>
          <EmptyState title="Nenhuma loja cadastrada" />
        </CardContent>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Endereço</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {storesQuery.data.items.map((store) => (
              <TableRow key={store.id}>
                <TableCell>{store.name}</TableCell>
                <TableCell>
                  <Badge variant="neutral">{store.type === "loja" ? "Loja" : "Depósito"}</Badge>
                </TableCell>
                <TableCell>{store.address ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      </Card>
    </div>
  );
}
