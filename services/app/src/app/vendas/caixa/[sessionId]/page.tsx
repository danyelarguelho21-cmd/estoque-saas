"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ManagerGate, ManagerUnlockedBar } from "@/components/features/manager-lock";
import { ConferenceTable, DifferenceBadge, SummaryGrid } from "@/components/features/cash/cash-shared";
import { cashApi } from "@/lib/api/cash";
import { formatCentsToBRL, formatDateTimeBR } from "@/lib/format";
import { paymentMethodDisplay } from "@/lib/payment-methods";

export default function CashSessionDetailPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <Link href="/vendas/caixa">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Caixa
            </Link>
          </Button>
          <h1 className="text-xl font-semibold text-slate-900">Detalhe do caixa</h1>
        </div>
        <ManagerUnlockedBar />
        <ManagerGate>
          <Detail sessionId={sessionId} />
        </ManagerGate>
      </div>
    </AppShell>
  );
}

function Detail({ sessionId }: { sessionId: string }) {
  const query = useQuery({ queryKey: ["cash", "session", sessionId], queryFn: () => cashApi.get(sessionId) });
  const session = query.data;
  if (query.isLoading) return <PageSpinner />;
  if (!session) return <EmptyState title="Caixa não encontrado" />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant={session.status === "open" ? "success" : "neutral"}>{session.status === "open" ? "Aberto" : "Fechado"}</Badge>
              <span className="font-medium text-slate-900">{session.storeName}</span>
            </div>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              Aberto em {formatDateTimeBR(session.openedAt)}
              {session.openedByName ? ` por ${session.openedByName}` : ""}
              {session.closedAt && ` · fechado em ${formatDateTimeBR(session.closedAt)}${session.closedByName ? ` por ${session.closedByName}` : ""}`}
            </p>
            {session.notes && <p className="mt-2 text-sm text-slate-700">Observação: {session.notes}</p>}
          </div>
          {session.status === "closed" && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
              Diferença total <DifferenceBadge cents={session.differences?.total} />
            </div>
          )}
        </CardContent>
      </Card>

      {session.summary && (
        <Card>
          <CardHeader>
            <CardTitle>Resumo</CardTitle>
          </CardHeader>
          <CardContent>
            <SummaryGrid summary={session.summary} />
          </CardContent>
        </Card>
      )}

      {session.status === "closed" && session.summary && (
        <Card>
          <CardHeader>
            <CardTitle>Conferência</CardTitle>
          </CardHeader>
          <ConferenceTable session={session} summary={session.summary} differences={session.differences} />
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sangrias e suprimentos</CardTitle>
        </CardHeader>
        {session.movements.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Por</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {session.movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{formatDateTimeBR(m.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={m.type === "sangria" ? "danger" : "success"}>{m.type === "sangria" ? "Sangria" : "Suprimento"}</Badge>
                  </TableCell>
                  <TableCell>{formatCentsToBRL(m.amountCents)}</TableCell>
                  <TableCell>{m.reason}</TableCell>
                  <TableCell>{m.createdByName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <CardContent>
            <p className="text-sm text-[var(--color-muted)]">Nenhuma sangria ou suprimento.</p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vendas do período ({session.sales?.length ?? 0})</CardTitle>
        </CardHeader>
        {session.sales?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Forma de pagamento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Vendedor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {session.sales.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/vendas/${s.id}`} className="text-[var(--color-primary)] hover:underline">
                      {formatDateTimeBR(s.createdAt)}
                    </Link>
                  </TableCell>
                  <TableCell>{paymentMethodDisplay(s.paymentMethod, s.paymentMethodLabel)}</TableCell>
                  <TableCell>{formatCentsToBRL(s.totalAmountCents)}</TableCell>
                  <TableCell>{s.sellerName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <CardContent>
            <p className="text-sm text-[var(--color-muted)]">Nenhuma venda neste caixa.</p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
