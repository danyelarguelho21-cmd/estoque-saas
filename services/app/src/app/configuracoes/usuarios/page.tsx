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
import { ConfigTabs } from "@/components/layout/config-tabs";
import { useToast } from "@/components/ui/toast";
import { tenantsApi } from "@/lib/api/tenants";
import { ApiError } from "@/lib/api/client";
import { ROLE_LABELS } from "@/lib/rbac";
import { usePlanLimits } from "@/hooks/use-plan-limits";
import type { Role } from "@/lib/api/types";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "admin", label: ROLE_LABELS.admin },
  { value: "operador", label: ROLE_LABELS.operador },
  { value: "vendedor", label: ROLE_LABELS.vendedor },
];

export default function UsersSettingsPage() {
  return (
    <AppShell>
      <RoleGate permission="users:manage" fallback={<EmptyState title="Acesso restrito" description="Apenas administradores podem gerenciar usuários." />}>
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Usuários e lojas</h1>
            <p className="text-sm text-[var(--color-muted)]">Convide usuários e defina papéis de acesso</p>
          </div>
          <ConfigTabs active="usuarios" />
          <UsersPanel />
        </div>
      </RoleGate>
    </AppShell>
  );
}

function UsersPanel() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: () => tenantsApi.listUsers({ limit: 100 }) });
  const { plan } = usePlanLimits();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("vendedor");
  const [submitting, setSubmitting] = useState(false);
  const [limitError, setLimitError] = useState(false);

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setLimitError(false);
    try {
      await tenantsApi.inviteUser({ name, email, role });
      notify({ title: "Convite enviado", variant: "success" });
      setOpen(false);
      setName("");
      setEmail("");
      setRole("vendedor");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setLimitError(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: Role) {
    await tenantsApi.updateUserRole(userId, newRole);
    notify({ title: "Papel atualizado", variant: "success" });
    await queryClient.invalidateQueries({ queryKey: ["users"] });
  }

  return (
    <div className="flex flex-col gap-4">
      {plan && usersQuery.data && !usersQuery.data.page.has_more && (
        <PlanLimitBanner resourceLabel="usuários" current={usersQuery.data.items.length} max={plan.maxUsers} />
      )}
      <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Usuários do tenant</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Convidar usuário
            </Button>
          </DialogTrigger>
          <DialogContent title="Convidar usuário" description="Um convite é enviado para o e-mail informado.">
            <form onSubmit={handleInvite} className="flex flex-col gap-4" noValidate>
              {limitError && (
                <p role="alert" className="text-sm text-[var(--color-danger)]">
                  Limite de usuários do plano atingido. Faça upgrade em Assinatura.
                </p>
              )}
              <Field label="Nome" htmlFor="inviteName" required>
                <Input id="inviteName" required value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="E-mail" htmlFor="inviteEmail" required>
                <Input id="inviteEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Papel" htmlFor="inviteRole" required>
                <Select id="inviteRole" value={role} onValueChange={(v) => setRole(v as Role)} options={ROLE_OPTIONS} />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" loading={submitting}>
                  Enviar convite
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      {usersQuery.isLoading ? (
        <PageSpinner />
      ) : !usersQuery.data?.items.length ? (
        <CardContent>
          <EmptyState title="Nenhum usuário cadastrado" />
        </CardContent>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersQuery.data.items.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell className="max-w-[180px]">
                  <Select
                    value={user.role}
                    onValueChange={(v) => handleRoleChange(user.id, v as Role)}
                    options={ROLE_OPTIONS}
                    aria-label={`Papel de ${user.name}`}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant={user.status === "active" ? "success" : user.status === "invited" ? "info" : "neutral"}>
                    {user.status === "active" ? "Ativo" : user.status === "invited" ? "Convite pendente" : "Desativado"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      </Card>
    </div>
  );
}
