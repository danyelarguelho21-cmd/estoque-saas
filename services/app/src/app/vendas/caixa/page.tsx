"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Coins, Receipt, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RoleGate } from "@/components/features/role-gate";
import { StatCard } from "@/components/features/stat-card";
import { ManagerUnlockedBar } from "@/components/features/manager-lock";
import { DeleteSaleButton } from "@/components/features/delete-sale-button";
import { MethodTotals } from "@/components/features/cash/cash-shared";
import { cashApi, formatCashDate, CASH_METHODS, type DayCash } from "@/lib/api/cash";
import { tenantsApi } from "@/lib/api/tenants";
import { ApiError } from "@/lib/api/client";
import { formatCentsToBRL, formatDateTimeBR } from "@/lib/format";

export default function CashPage() {
  return (
    <AppShell>
      <RoleGate permission="sales:create" fallback={<EmptyState title="Acesso restrito" description="Seu papel não usa o caixa." />}>
        <Suspense fallback={<PageSpinner />}>
          <CashPageContent />
        </Suspense>
      </RoleGate>
    </AppShell>
  );
}

function CashPageContent() {
  const searchParams = useSearchParams();
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: () => tenantsApi.listStores({ limit: 100 }) });
  const stores = storesQuery.data?.items ?? [];

  // ?store=...&date=... vem do aviso "você não fechou o caixa".
  const [chosenStoreId, setChosenStoreId] = useState<string | null>(searchParams.get("store"));
  const [date, setDate] = useState<string | null>(searchParams.get("date"));
  const storeId = (chosenStoreId && stores.some((s) => s.id === chosenStoreId) ? chosenStoreId : null) ?? stores[0]?.id ?? null;

  function openDay(store: string, day: string | null) {
    setChosenStoreId(store);
    setDate(day);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Caixa do dia</h1>
          <p className="text-sm text-[var(--color-muted)]">Toda venda lançada entra aqui sozinha. No fim do dia, é só fechar o caixa.</p>
        </div>
        {stores.length > 1 && storeId && (
          <div className="w-full max-w-[240px]">
            <Select
              value={storeId}
              onValueChange={(id) => openDay(id, null)}
              options={stores.map((s) => ({ value: s.id, label: s.name }))}
              aria-label="Loja"
            />
          </div>
        )}
      </div>

      <ManagerUnlockedBar />

      <PendingDays onOpen={openDay} current={storeId && date ? { storeId, date } : null} />

      {storesQuery.isLoading ? (
        <PageSpinner />
      ) : !storeId ? (
        <EmptyState title="Nenhuma loja cadastrada" description="Cadastre uma loja em Usuários e lojas." />
      ) : (
        <DayCashPanel key={`${storeId}|${date ?? "hoje"}`} storeId={storeId} date={date} onChangeDate={setDate} />
      )}

      <RecentClosings onOpen={openDay} />
    </div>
  );
}

/** Aviso: dias anteriores que tiveram venda e o caixa não foi fechado. */
function PendingDays({ onOpen, current }: { onOpen: (storeId: string, date: string) => void; current: { storeId: string; date: string } | null }) {
  const pendingQuery = useQuery({ queryKey: ["cash", "pending"], queryFn: () => cashApi.pending() });
  const pending = (pendingQuery.data ?? []).filter((p) => !(current && p.storeId === current.storeId && p.date === current.date));
  if (!pending.length) return null;

  return (
    <Alert variant="warning" title={pending.length === 1 ? "Você não fechou um caixa" : `Você tem ${pending.length} caixas sem fechar`}>
      <ul className="mt-2 flex flex-col gap-2">
        {pending.map((p) => (
          <li key={`${p.storeId}|${p.date}`} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>{formatCashDate(p.date)}</b>
              {p.storeName && ` · ${p.storeName}`} — {p.salesCount} venda(s), {formatCentsToBRL(p.salesTotalCents)}
              {p.changedAfterClosing && " (as vendas mudaram depois do fechamento)"}
            </span>
            <Button size="sm" onClick={() => onOpen(p.storeId, p.date)}>
              Fechar esse caixa
            </Button>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function DayCashPanel({ storeId, date, onChangeDate }: { storeId: string; date: string | null; onChangeDate: (date: string | null) => void }) {
  const dayQuery = useQuery({ queryKey: ["cash", "day", storeId, date ?? "hoje"], queryFn: () => cashApi.day(storeId, date ?? undefined) });
  const day = dayQuery.data;

  if (dayQuery.isLoading) return <PageSpinner />;
  if (dayQuery.isError || !day) return <Alert variant="danger">Não foi possível carregar o caixa agora. Atualize a página.</Alert>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            {day.isToday ? "Hoje" : "Dia"}, {formatCashDate(day.date)}
          </h2>
          <span className="text-sm text-[var(--color-muted)]">· {day.storeName}</span>
          {day.closing && !day.changedAfterClosing ? <Badge variant="success">Fechado</Badge> : <Badge variant="warning">Aberto</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {!day.isToday && (
            <Button variant="outline" size="sm" onClick={() => onChangeDate(null)}>
              Voltar para hoje
            </Button>
          )}
          <Input
            type="date"
            aria-label="Ver outro dia"
            className="w-44"
            value={day.date}
            onChange={(e) => e.target.value && onChangeDate(e.target.value)}
          />
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${day.profitCents === null ? "sm:grid-cols-1" : "sm:grid-cols-3"}`}>
        <StatCard label="Total vendido" value={formatCentsToBRL(day.salesTotalCents)} icon={Receipt} hint={`${day.salesCount} venda(s)`} />
        <ProfitCards day={day} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Como você recebeu</CardTitle>
        </CardHeader>
        <CardContent>
          <MethodTotals byMethod={day.byMethod} />
        </CardContent>
      </Card>

      <CloseDayCard day={day} />

      <Card>
        <CardHeader>
          <CardTitle>Vendas do dia</CardTitle>
        </CardHeader>
        <CardContent>
          {!day.sales.length ? (
            <EmptyState title="Nenhuma venda neste dia" description="As vendas lançadas aparecem aqui automaticamente." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hora</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="w-12"><span className="sr-only">Apagar</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {day.sales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/vendas/${s.id}`} className="text-[var(--color-primary)] hover:underline">
                        {new Date(s.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Campo_Grande" })}
                      </Link>
                    </TableCell>
                    <TableCell>{formatCentsToBRL(s.totalAmountCents)}</TableCell>
                    <TableCell>{CASH_METHODS.find((m) => m.key === s.paymentMethod)?.label ?? "Não informado"}</TableCell>
                    <TableCell>{s.sellerName ?? "—"}</TableCell>
                    <TableCell>
                      <DeleteSaleButton saleId={s.id} totalCents={s.totalAmountCents} compact />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Custo e lucro: só admin/operador (a API não manda esses valores para o vendedor). */
function ProfitCards({ day }: { day: DayCash }) {
  if (day.profitCents === null) return null;
  return (
    <>
      <StatCard label="Custo dos produtos" value={formatCentsToBRL(day.costTotalCents ?? 0)} icon={Coins} hint="Pelo preço de custo cadastrado" />
      <StatCard
        label="Lucro do dia"
        value={formatCentsToBRL(day.profitCents)}
        icon={TrendingUp}
        tone={day.profitCents < 0 ? "danger" : "success"}
        hint="Total vendido − custo"
      />
    </>
  );
}

function CloseDayCard({ day }: { day: DayCash }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const closedOk = day.closing && !day.changedAfterClosing;

  async function handleClose() {
    setSubmitting(true);
    setError(null);
    try {
      await cashApi.close({ storeId: day.storeId, date: day.date, ...(notes.trim() ? { notes: notes.trim() } : {}) });
      notify({ title: `Caixa de ${formatCashDate(day.date)} fechado`, variant: "success" });
      setConfirming(false);
      setNotes("");
      await queryClient.invalidateQueries({ queryKey: ["cash"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível fechar o caixa agora.");
    } finally {
      setSubmitting(false);
    }
  }

  if (closedOk && day.closing) {
    return (
      <Alert variant="success" title="Caixa fechado">
        Fechado em {formatDateTimeBR(day.closing.closedAt)}
        {day.closing.closedByName && ` por ${day.closing.closedByName}`}.{day.closing.notes && ` Observação: ${day.closing.notes}`}
        {day.isToday && " Se vender mais hoje (ou apagar uma venda), o sistema pede para fechar de novo."}
      </Alert>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        {day.closing && day.changedAfterClosing && (
          <Alert variant="warning" title="As vendas mudaram depois do fechamento">
            O caixa foi fechado com {day.closing.salesCount} venda(s) ({formatCentsToBRL(day.closing.salesTotalCents)}), mas agora tem {day.salesCount} (
            {formatCentsToBRL(day.salesTotalCents)}). Feche de novo para atualizar.
          </Alert>
        )}
        {!day.isToday && !day.closing && (
          <Alert variant="warning" title="Este caixa ficou aberto">
            O caixa de {formatCashDate(day.date)} não foi fechado. Confira os valores e feche agora.
          </Alert>
        )}

        {!confirming ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--color-muted)]">Terminou o dia? Confira os valores acima e feche o caixa.</p>
            <Button size="lg" onClick={() => setConfirming(true)}>
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {day.closing ? "Fechar de novo" : "Fechar caixa do dia"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] p-4 text-sm">
              <p className="mb-2 font-medium text-slate-900">
                Confirma o fechamento de {formatCashDate(day.date)}? Total vendido: {formatCentsToBRL(day.salesTotalCents)} ({day.salesCount} venda(s))
              </p>
              <ul className="grid gap-1 sm:grid-cols-2">
                {CASH_METHODS.filter((m) => day.byMethod[m.key] > 0 || ["dinheiro", "pix"].includes(m.key)).map((m) => (
                  <li key={m.key} className="flex justify-between gap-3">
                    <span className="text-[var(--color-muted)]">{m.label}</span>
                    <span className="font-medium text-slate-900">{formatCentsToBRL(day.byMethod[m.key])}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Field label="Observação (opcional)" htmlFor="closeNotes" hint="Ex.: faltou R$ 5,00 de troco">
              <Textarea id="closeNotes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {error && <Alert variant="danger">{error}</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button size="lg" loading={submitting} onClick={handleClose}>
                Confirmar fechamento
              </Button>
              <Button variant="outline" size="lg" onClick={() => setConfirming(false)} disabled={submitting}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentClosings({ onOpen }: { onOpen: (storeId: string, date: string) => void }) {
  const closingsQuery = useQuery({ queryKey: ["cash", "closings"], queryFn: () => cashApi.closings({ limit: 30 }) });
  const closings = closingsQuery.data ?? [];
  const showProfit = closings.some((c) => c.profitCents !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Caixas fechados</CardTitle>
      </CardHeader>
      <CardContent>
        {closingsQuery.isLoading ? (
          <PageSpinner />
        ) : !closings.length ? (
          <EmptyState title="Nenhum caixa fechado ainda" description="Quando você fechar o caixa do dia, ele aparece aqui." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dia</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead>Vendido</TableHead>
                <TableHead>Dinheiro</TableHead>
                <TableHead>Pix</TableHead>
                <TableHead>Cartão</TableHead>
                {showProfit && <TableHead>Lucro</TableHead>}
                <TableHead>Fechado por</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {closings.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <button type="button" className="text-[var(--color-primary)] hover:underline" onClick={() => onOpen(c.storeId, c.date)}>
                      {formatCashDate(c.date)}
                    </button>
                  </TableCell>
                  <TableCell>{c.storeName}</TableCell>
                  <TableCell>{formatCentsToBRL(c.salesTotalCents)}</TableCell>
                  <TableCell>{formatCentsToBRL(c.byMethod.dinheiro)}</TableCell>
                  <TableCell>{formatCentsToBRL(c.byMethod.pix)}</TableCell>
                  <TableCell>{formatCentsToBRL(c.byMethod.cartao_debito + c.byMethod.cartao_credito)}</TableCell>
                  {showProfit && (
                    <TableCell className={(c.profitCents ?? 0) < 0 ? "text-red-600" : undefined}>{c.profitCents === null ? "—" : formatCentsToBRL(c.profitCents)}</TableCell>
                  )}
                  <TableCell>
                    {c.closedByName ?? "—"}
                    <span className="block text-xs text-[var(--color-muted)]">{formatDateTimeBR(c.closedAt)}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
