"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "@/components/layout/admin-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { platformAdminApi } from "@/lib/api/admin";
import { formatDateBR } from "@/lib/format";
import type { SubscriptionStatus, TenantAdminSummary } from "@/lib/api/types";

const STATUS_OPTIONS = [
  { value: "__all__", label: "Todos os status" },
  { value: "trialing", label: "Teste" },
  { value: "active", label: "Ativa" },
  { value: "past_due", label: "Inadimplente" },
  { value: "canceled", label: "Cancelada" },
];

const STATUS_BADGE: Record<SubscriptionStatus, "success" | "danger" | "neutral" | "info"> = {
  trialing: "info",
  active: "success",
  past_due: "danger",
  canceled: "neutral",
};

export default function PlatformTenantsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);

  const tenantsQuery = useQuery({
    queryKey: ["platform-tenants", statusFilter, cursor],
    queryFn: () =>
      platformAdminApi.listTenants({
        subscriptionStatus: statusFilter === "__all__" ? undefined : (statusFilter as SubscriptionStatus),
        cursor,
        limit: 20,
      }),
  });

  function goNext() {
    if (!tenantsQuery.data?.page.next_cursor) return;
    setCursorHistory((h) => [...h, cursor ?? ""]);
    setCursor(tenantsQuery.data.page.next_cursor);
  }
  function goPrevious() {
    setCursorHistory((h) => {
      const next = [...h];
      const previous = next.pop();
      setCursor(previous || undefined);
      return next;
    });
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
  }

  return (
    <AdminShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">Assinantes</h1>
            <p className="text-sm text-slate-400">Todos os tenants da plataforma</p>
          </div>
          <div className="w-full max-w-[200px]">
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setCursor(undefined);
                setCursorHistory([]);
                setStatusFilter(v);
              }}
              options={STATUS_OPTIONS}
            />
          </div>
        </div>

        <Card className="border-slate-800 bg-slate-900">
          {tenantsQuery.isLoading ? (
            <PageSpinner />
          ) : !tenantsQuery.data?.items.length ? (
            <EmptyState title="Nenhum tenant encontrado" className="border-slate-800 text-slate-300" />
          ) : (
            <>
              <Table className="text-slate-200">
                <TableHeader className="bg-slate-800 text-slate-400">
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Assinatura</TableHead>
                    <TableHead>Status da conta</TableHead>
                    <TableHead>Desde</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-slate-800">
                  {tenantsQuery.data.items.map((tenant) => (
                    <TableRow key={tenant.id} className="hover:bg-slate-800/50">
                      <TableCell className="text-slate-100">
                        {tenant.name}
                        <span className="block text-xs text-slate-500">{tenant.cnpj}</span>
                      </TableCell>
                      <TableCell>{tenant.planName}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE[tenant.subscriptionStatus]}>{tenant.subscriptionStatus}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={tenant.status === "active" ? "success" : tenant.status === "suspended" ? "danger" : "neutral"}>
                          {tenant.status === "active" ? "Ativa" : tenant.status === "suspended" ? "Suspensa" : "Cancelada"}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDateBR(tenant.createdAt)}</TableCell>
                      <TableCell>
                        <TenantAction tenant={tenant} onDone={refresh} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                hasMore={tenantsQuery.data.page.has_more}
                onNext={goNext}
                onPrevious={goPrevious}
                canGoBack={cursorHistory.length > 0}
                loading={tenantsQuery.isFetching}
              />
            </>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}

function TenantAction({ tenant, onDone }: { tenant: TenantAdminSummary; onDone: () => void }) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const suspending = tenant.status === "active";

  async function handleConfirm() {
    setSubmitting(true);
    try {
      if (suspending) {
        await platformAdminApi.suspendTenant(tenant.id);
        notify({ title: `${tenant.name} suspenso`, variant: "info" });
      } else {
        await platformAdminApi.reactivateTenant(tenant.id);
        notify({ title: `${tenant.name} reativado`, variant: "success" });
      }
      setOpen(false);
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  if (tenant.status === "canceled") {
    return <span className="text-xs text-slate-600">—</span>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={suspending ? "danger" : "outline"}>
          {suspending ? "Suspender" : "Reativar"}
        </Button>
      </DialogTrigger>
      <DialogContent title={suspending ? "Suspender tenant" : "Reativar tenant"}>
        <p className="text-sm text-slate-600">
          {suspending
            ? `${tenant.name} perderá acesso ao sistema imediatamente. Use para inadimplência crítica ou abuso.`
            : `${tenant.name} recuperará acesso normal ao sistema.`}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant={suspending ? "danger" : "primary"} loading={submitting} onClick={handleConfirm}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
