"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, FileText, AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StoreFilter } from "@/components/features/store-filter";
import { RoleGate } from "@/components/features/role-gate";
import { stockApi } from "@/lib/api/stock";
import { STOCK_MOVEMENT_BADGE, STOCK_MOVEMENT_LABELS } from "@/lib/stock-labels";
import { formatDateTimeBR } from "@/lib/format";

const QUICK_ACTIONS = [
  { href: "/estoque/entrada", label: "Entrada manual", icon: ArrowDownToLine },
  { href: "/estoque/saida", label: "Saída (perda/ajuste)", icon: ArrowUpFromLine },
  { href: "/estoque/transferencias", label: "Transferência", icon: ArrowRightLeft },
  { href: "/estoque/nfe", label: "Importar NF-e", icon: FileText },
  { href: "/estoque/alertas", label: "Alertas", icon: AlertTriangle },
];

export default function StockPage() {
  const [storeId, setStoreId] = useState<string | undefined>(undefined);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);

  const movementsQuery = useQuery({
    queryKey: ["stock-movements", storeId, cursor],
    queryFn: () => stockApi.listMovements({ storeId, cursor, limit: 20 }),
  });

  function goNext() {
    if (!movementsQuery.data?.page.next_cursor) return;
    setCursorHistory((h) => [...h, cursor ?? ""]);
    setCursor(movementsQuery.data.page.next_cursor);
  }
  function goPrevious() {
    setCursorHistory((h) => {
      const next = [...h];
      const previous = next.pop();
      setCursor(previous || undefined);
      return next;
    });
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Estoque</h1>
            <p className="text-sm text-[var(--color-muted)]">Movimentações, entradas, saídas e transferências</p>
          </div>
          <div className="w-full max-w-[220px]">
            <StoreFilter value={storeId} onChange={setStoreId} />
          </div>
        </div>

        <RoleGate permission="stock:entry">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {QUICK_ACTIONS.map((action) => (
              <Button key={action.href} asChild variant="outline" className="h-auto flex-col gap-2 py-4">
                <Link href={action.href}>
                  <action.icon className="h-5 w-5" />
                  <span className="text-xs">{action.label}</span>
                </Link>
              </Button>
            ))}
          </div>
        </RoleGate>

        <Card>
          <div className="border-b border-[var(--color-border)] p-4">
            <h2 className="text-sm font-semibold text-slate-900">Histórico de movimentações</h2>
          </div>
          {movementsQuery.isLoading ? (
            <PageSpinner />
          ) : !movementsQuery.data?.items.length ? (
            <EmptyState title="Nenhuma movimentação registrada" description="Registre uma entrada ou saída de estoque." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Quantidade</TableHead>
                    <TableHead>Saldo após</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movementsQuery.data.items.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell>{formatDateTimeBR(movement.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant={STOCK_MOVEMENT_BADGE[movement.type]}>{STOCK_MOVEMENT_LABELS[movement.type]}</Badge>
                      </TableCell>
                      <TableCell>{movement.quantity}</TableCell>
                      <TableCell>{movement.balanceAfter}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                hasMore={movementsQuery.data.page.has_more}
                onNext={goNext}
                onPrevious={goPrevious}
                canGoBack={cursorHistory.length > 0}
                loading={movementsQuery.isFetching}
              />
            </>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
