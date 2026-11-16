"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, Lock, Wallet } from "lucide-react";
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
import { StoreFilter } from "@/components/features/store-filter";
import { ManagerGate, ManagerUnlockedBar } from "@/components/features/manager-lock";
import { ConferenceTable, DifferenceBadge, SummaryGrid } from "@/components/features/cash/cash-shared";
import { cashApi, parseMoneyToCents, type CashSession } from "@/lib/api/cash";
import { tenantsApi } from "@/lib/api/tenants";
import { ApiError } from "@/lib/api/client";
import { formatCentsToBRL, formatDateTimeBR } from "@/lib/format";

export default function CashRegisterPage() {
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: () => tenantsApi.listStores({ limit: 100 }) });
  const stores = storesQuery.data?.items ?? [];
  const [chosenStoreId, setChosenStoreId] = useState<string | null>(null);
  const storeId = chosenStoreId ?? stores[0]?.id ?? null;

  return (
    <AppShell>
      <RoleGate permission="sales:create" fallback={<EmptyState title="Acesso restrito" description="Seu papel não opera o caixa." />}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Caixa</h1>
              <p className="text-sm text-[var(--color-muted)]">Abertura, sangria, suprimento e fechamento do caixa do dia</p>
            </div>
            {stores.length > 1 && (
              <div className="w-full max-w-[240px]">
                <Select
                  value={storeId ?? undefined}
                  onValueChange={setChosenStoreId}
                  options={stores.map((s) => ({ value: s.id, label: s.name }))}
                  aria-label="Loja do caixa"
                />
              </div>
            )}
          </div>

          <ManagerUnlockedBar />

          {storesQuery.isLoading ? (
            <PageSpinner />
          ) : !storeId ? (
            <EmptyState title="Nenhuma loja cadastrada" description="Cadastre uma loja em Usuários e lojas." />
          ) : (
            <StoreCashPanel storeId={storeId} storeName={stores.find((s) => s.id === storeId)?.name ?? ""} />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Histórico de fechamentos</CardTitle>
            </CardHeader>
            <CardContent>
              <ManagerGate compact>
                <CashHistory />
              </ManagerGate>
            </CardContent>
          </Card>
        </div>
      </RoleGate>
    </AppShell>
  );
}

function StoreCashPanel({ storeId, storeName }: { storeId: string; storeName: string }) {
  const openQuery = useQuery({ queryKey: ["cash", "open", storeId], queryFn: () => cashApi.listOpen(storeId) });
  const openSessionId = openQuery.data?.[0]?.id ?? null;
  const [justClosed, setJustClosed] = useState<CashSession | null>(null);

  if (openQuery.isLoading) return <PageSpinner />;
  if (justClosed) return <ClosedResult session={justClosed} onDone={() => setJustClosed(null)} />;
  if (!openSessionId) return <OpenCashForm storeId={storeId} storeName={storeName} />;
  return <OpenSessionView sessionId={openSessionId} onClosed={setJustClosed} />;
}

function OpenCashForm({ storeId, storeName }: { storeId: string; storeName: string }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [opening, setOpening] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = opening.trim() === "" ? 0 : parseMoneyToCents(opening);
    if (cents === null) {
      setError("Informe o troco inicial em reais, por exemplo 150,00.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await cashApi.open(storeId, cents);
      notify({ title: "Caixa aberto", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["cash"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível abrir o caixa agora.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-[var(--color-primary)]" aria-hidden />
          Abrir caixa {storeName && <span className="font-normal text-[var(--color-muted)]">· {storeName}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3" noValidate>
          <Field label="Troco inicial na gaveta (R$)" htmlFor="openingAmount" hint="Dinheiro que já está na gaveta antes da primeira venda">
            <Input id="openingAmount" inputMode="decimal" placeholder="0,00" className="w-48" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </Field>
          <Button type="submit" loading={submitting}>
            Abrir caixa
          </Button>
          {error && (
            <Alert variant="danger" className="w-full">
              {error}
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function OpenSessionView({ sessionId, onClosed }: { sessionId: string; onClosed: (s: CashSession) => void }) {
  const sessionQuery = useQuery({ queryKey: ["cash", "session", sessionId], queryFn: () => cashApi.get(sessionId), refetchInterval: 30_000 });
  const session = sessionQuery.data;
  if (sessionQuery.isLoading || !session) return <PageSpinner />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="success">Caixa aberto</Badge>
              <span className="text-sm font-medium text-slate-900">{session.storeName}</span>
            </div>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              Aberto em {formatDateTimeBR(session.openedAt)}
              {session.openedByName ? ` por ${session.openedByName}` : ""} · troco inicial {formatCentsToBRL(session.openingAmountCents)}
            </p>
          </div>
        </CardContent>
      </Card>

      {session.financial && session.summary && (
        <Card>
          <CardHeader>
            <CardTitle>Até agora</CardTitle>
          </CardHeader>
          <CardContent>
            <SummaryGrid summary={session.summary} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <MovementsCard session={session} />
        <CloseCashForm session={session} onClosed={onClosed} />
      </div>
    </div>
  );
}

function MovementsCard({ session }: { session: CashSession }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [type, setType] = useState<"sangria" | "suprimento">("sangria");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = parseMoneyToCents(amount);
    if (!cents) {
      setError("Informe um valor maior que zero.");
      return;
    }
    if (!reason.trim()) {
      setError("Informe o motivo.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await cashApi.addMovement(session.id, { type, amountCents: cents, reason: reason.trim() });
      notify({ title: type === "sangria" ? "Sangria registrada" : "Suprimento registrado", variant: "success" });
      setAmount("");
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["cash", "session", session.id] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível registrar agora.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sangria e suprimento</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { key: "sangria", label: "Sangria", hint: "Retirar dinheiro", Icon: ArrowUpCircle },
                { key: "suprimento", label: "Suprimento", hint: "Colocar dinheiro", Icon: ArrowDownCircle },
              ] as const
            ).map(({ key, label, hint, Icon }) => (
              <button
                key={key}
                type="button"
                aria-pressed={type === key}
                onClick={() => setType(key)}
                className={`flex items-center gap-2 rounded-lg border-2 p-3 text-left ${type === key ? "border-[var(--color-primary)] bg-blue-50" : "border-[var(--color-border)]"}`}
              >
                <Icon className="h-4 w-4 text-[var(--color-primary)]" aria-hidden />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{label}</span>
                  <span className="block text-xs text-[var(--color-muted)]">{hint}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <Field label="Valor (R$)" htmlFor="movementAmount">
              <Input id="movementAmount" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Motivo" htmlFor="movementReason">
              <Input
                id="movementReason"
                placeholder={type === "sangria" ? "Ex.: depósito no banco, pagamento de entregador" : "Ex.: reforço de troco"}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
          {error && <Alert variant="danger">{error}</Alert>}
          <Button type="submit" variant="outline" loading={submitting}>
            Registrar {type}
          </Button>
        </form>

        {session.movements.length > 0 ? (
          <div className="flex flex-col gap-2">
            {session.movements.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className={m.type === "sangria" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}>
                    {m.type === "sangria" ? "− " : "+ "}
                    {formatCentsToBRL(m.amountCents)}
                  </span>{" "}
                  <span className="text-slate-700">{m.reason}</span>
                </span>
                <span className="shrink-0 text-xs text-[var(--color-muted)]">
                  {formatDateTimeBR(m.createdAt)}
                  {m.createdByName ? ` · ${m.createdByName}` : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">Nenhuma sangria ou suprimento neste caixa.</p>
        )}
      </CardContent>
    </Card>
  );
}

function CloseCashForm({ session, onClosed }: { session: CashSession; onClosed: (s: CashSession) => void }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [cash, setCash] = useState("");
  const [pix, setPix] = useState("");
  const [debit, setDebit] = useState("");
  const [credit, setCredit] = useState("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function optionalCents(value: string, label: string): number | undefined | "invalid" {
    if (!value.trim()) return undefined;
    const c = parseMoneyToCents(value);
    if (c === null) {
      setError(`Valor inválido em ${label}.`);
      return "invalid";
    }
    return c;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const countedCash = parseMoneyToCents(cash);
    if (countedCash === null) {
      setError("Informe quanto dinheiro você contou na gaveta (use 0,00 se estiver vazia).");
      return;
    }
    const p = optionalCents(pix, "Pix");
    const d = optionalCents(debit, "Débito");
    const c = optionalCents(credit, "Crédito");
    if (p === "invalid" || d === "invalid" || c === "invalid") return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setSubmitting(true);
    try {
      const closed = await cashApi.close(session.id, {
        countedCashCents: countedCash,
        ...(p !== undefined ? { countedPixCents: p } : {}),
        ...(d !== undefined ? { countedDebitCents: d } : {}),
        ...(c !== undefined ? { countedCreditCents: c } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      notify({ title: "Caixa fechado", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["cash"] });
      onClosed(closed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível fechar o caixa agora.");
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-[var(--color-primary)]" aria-hidden />
          Fechar caixa
        </CardTitle>
        <p className="text-sm text-[var(--color-muted)]">
          Conte o dinheiro da gaveta e, se quiser, confira os totais de Pix e cartão na maquininha.
          {!session.financial && " O gestor confere a diferença depois."}
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
          <Field label="Dinheiro contado na gaveta (R$)" htmlFor="countedCash" required>
            <Input id="countedCash" inputMode="decimal" placeholder="0,00" value={cash} onChange={(e) => { setCash(e.target.value); setConfirming(false); }} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Pix conferido" htmlFor="countedPix" hint="Opcional">
              <Input id="countedPix" inputMode="decimal" placeholder="0,00" value={pix} onChange={(e) => { setPix(e.target.value); setConfirming(false); }} />
            </Field>
            <Field label="Débito conferido" htmlFor="countedDebit" hint="Opcional">
              <Input id="countedDebit" inputMode="decimal" placeholder="0,00" value={debit} onChange={(e) => { setDebit(e.target.value); setConfirming(false); }} />
            </Field>
            <Field label="Crédito conferido" htmlFor="countedCredit" hint="Opcional">
              <Input id="countedCredit" inputMode="decimal" placeholder="0,00" value={credit} onChange={(e) => { setCredit(e.target.value); setConfirming(false); }} />
            </Field>
          </div>
          <Field label="Observação" htmlFor="closeNotes" hint="Opcional">
            <Textarea id="closeNotes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: R$ 10 de troco faltando, cliente pagou depois" />
          </Field>
          {error && <Alert variant="danger">{error}</Alert>}
          {confirming && (
            <Alert variant="warning" title="Confirme o fechamento">
              Depois de fechado, o caixa não pode ser reaberto. Clique de novo para confirmar.
            </Alert>
          )}
          <Button type="submit" loading={submitting}>
            {confirming ? "Confirmar fechamento" : "Fechar caixa"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ClosedResult({ session, onDone }: { session: CashSession; onDone: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Caixa fechado · {session.storeName}</CardTitle>
        <p className="text-sm text-[var(--color-muted)]">
          {formatDateTimeBR(session.openedAt)} até {session.closedAt ? formatDateTimeBR(session.closedAt) : "—"}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {session.financial && session.summary ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-700">Resultado do dinheiro:</span>
              <DifferenceBadge cents={session.differences?.cash} />
              <span className="text-sm text-slate-700">Total:</span>
              <DifferenceBadge cents={session.differences?.total} />
            </div>
            <SummaryGrid summary={session.summary} />
            <ConferenceTable session={session} summary={session.summary} differences={session.differences} />
          </>
        ) : (
          <Alert variant="success" title="Fechamento enviado">
            Os valores que você contou foram registrados. O gestor confere o resultado.
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onDone}>
            Abrir novo caixa
          </Button>
          {session.financial && (
            <Button asChild variant="outline">
              <Link href={`/vendas/caixa/${session.id}`}>Ver detalhes</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CashHistory() {
  const [storeId, setStoreId] = useState<string | undefined>(undefined);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const historyQuery = useQuery({
    queryKey: ["cash", "history", storeId, from, to],
    queryFn: () => cashApi.history({ storeId, from: from || undefined, to: to || undefined, limit: 50 }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-[220px]">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Loja</span>
          <StoreFilter value={storeId} onChange={setStoreId} />
        </div>
        <div className="w-full max-w-[180px]">
          <label htmlFor="histFrom" className="mb-1.5 block text-sm font-medium text-slate-700">De</label>
          <Input id="histFrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-full max-w-[180px]">
          <label htmlFor="histTo" className="mb-1.5 block text-sm font-medium text-slate-700">Até</label>
          <Input id="histTo" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      {historyQuery.isLoading ? (
        <PageSpinner />
      ) : !historyQuery.data?.items.length ? (
        <EmptyState title="Nenhum caixa fechado" description="Os fechamentos aparecem aqui assim que um caixa for fechado." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loja</TableHead>
              <TableHead>Abertura</TableHead>
              <TableHead>Fechamento</TableHead>
              <TableHead>Vendas</TableHead>
              <TableHead>Dinheiro</TableHead>
              <TableHead>Diferença total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {historyQuery.data.items.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link href={`/vendas/caixa/${s.id}`} className="text-[var(--color-primary)] hover:underline">
                    {s.storeName}
                  </Link>
                </TableCell>
                <TableCell>
                  {formatDateTimeBR(s.openedAt)}
                  {s.openedByName && <span className="block text-xs text-[var(--color-muted)]">{s.openedByName}</span>}
                </TableCell>
                <TableCell>
                  {s.closedAt ? formatDateTimeBR(s.closedAt) : "—"}
                  {s.closedByName && <span className="block text-xs text-[var(--color-muted)]">{s.closedByName}</span>}
                </TableCell>
                <TableCell>
                  {formatCentsToBRL(s.salesTotalCents)}
                  <span className="block text-xs text-[var(--color-muted)]">{s.salesCount} venda(s)</span>
                </TableCell>
                <TableCell>
                  <DifferenceBadge cents={s.cashDifferenceCents} />
                </TableCell>
                <TableCell>
                  <DifferenceBadge cents={s.totalDifferenceCents} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
