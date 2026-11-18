// Caixa do dia (versão simples).
//
// Não existe "abrir caixa": toda venda concluída entra automaticamente no caixa do DIA dela
// (fuso de MS), por loja. No fim do dia alguém clica em "Fechar caixa do dia" e o sistema grava
// uma "fotografia" do dia (vendas, total por forma de pagamento, custo) em cash_closings.
//
// Dia pendente = dia anterior a hoje que teve venda e não foi fechado — ou que foi fechado, mas
// depois recebeu venda (ex.: venda lançada com data passada). O sistema avisa até alguém fechar.
//
// Lucro do dia = total vendido − custo (quantidade × preço de custo atual do produto). Vendedor
// nunca recebe custo/lucro (nem com a senha do gestor) — ver as rotas.
import { Prisma } from "@prisma/client";
import { NotFoundError, ValidationError, recordAudit, withTenant, type TenantScopedClient } from "@estoque-saas/shared";
import { PAYMENT_METHODS, isPaymentMethod, type PaymentMethod } from "@/lib/payment-methods";

const CASH_TIMEZONE = "America/Campo_Grande";
const CASH_TIMEZONE_OFFSET = "-04:00"; // MS sem horário de verão — mesmo de sales.ts
// Dias antes do lançamento do fechamento de caixa nunca ficam "pendentes" — senão todo cliente
// antigo receberia aviso de semanas de caixas que nunca existiram.
const CASH_CLOSING_START_DATE = "2026-11-16";
const PENDING_LOOKBACK_DAYS = 60;

export type CashMethodKey = PaymentMethod | "nao_informado";
export const CASH_METHOD_KEYS: readonly CashMethodKey[] = [...PAYMENT_METHODS, "nao_informado"];
export type CashByMethod = Record<CashMethodKey, number>;

export interface DayCashSale {
  id: string;
  createdAt: Date;
  totalAmountCents: number;
  paymentMethod: CashMethodKey;
  sellerName: string | null;
}

export interface DayCashClosing {
  closedAt: Date;
  closedByName: string | null;
  notes: string | null;
  salesCount: number;
  salesTotalCents: number;
}

export interface DayCash {
  storeId: string;
  storeName: string;
  /** AAAA-MM-DD (fuso de MS). */
  date: string;
  isToday: boolean;
  salesCount: number;
  salesTotalCents: number;
  /** Total em centavos por forma de pagamento. */
  byMethod: CashByMethod;
  /** null = sem acesso financeiro. */
  costTotalCents: number | null;
  profitCents: number | null;
  sales: DayCashSale[];
  closing: DayCashClosing | null;
  /** Fechado, mas entrou venda depois — precisa fechar de novo. */
  changedAfterClosing: boolean;
}

export interface PendingCashDay {
  storeId: string;
  storeName: string;
  date: string;
  salesCount: number;
  salesTotalCents: number;
  /** true = já tinha sido fechado, mas entrou venda depois. */
  changedAfterClosing: boolean;
}

export interface CashClosingListItem {
  id: string;
  storeId: string;
  storeName: string;
  date: string;
  salesCount: number;
  salesTotalCents: number;
  byMethod: CashByMethod;
  costTotalCents: number | null;
  profitCents: number | null;
  closedAt: Date;
  closedByName: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------------------------

export function todayInCashTimezone(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CASH_TIMEZONE }).format(new Date());
}

function assertDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new ValidationError("Data inválida.");
  }
  if (date > todayInCashTimezone()) throw new ValidationError("Não dá para ver ou fechar o caixa de um dia que ainda não chegou.");
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Início (inclusive) e fim (exclusive) do dia no fuso de MS, como instantes UTC. */
function dayRange(date: string): { from: Date; to: Date } {
  return { from: new Date(`${date}T00:00:00${CASH_TIMEZONE_OFFSET}`), to: new Date(`${addDays(date, 1)}T00:00:00${CASH_TIMEZONE_OFFSET}`) };
}

/** Coluna DATE do Postgres ↔ Date do Prisma (meia-noite UTC). */
function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function fromDbDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------------------------

function emptyByMethod(): CashByMethod {
  return { dinheiro: 0, pix: 0, cartao_debito: 0, cartao_credito: 0, outro: 0, nao_informado: 0 };
}

function methodKey(paymentMethod: string | null): CashMethodKey {
  return isPaymentMethod(paymentMethod) ? paymentMethod : "nao_informado";
}

function parseByMethod(value: Prisma.JsonValue): CashByMethod {
  const result = emptyByMethod();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of CASH_METHOD_KEYS) {
      const cents = (value as Record<string, unknown>)[key];
      if (typeof cents === "number") result[key] = cents;
    }
  }
  return result;
}

async function userNames(tx: TenantScopedClient, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

interface DayTotals {
  sales: Array<{ id: string; createdAt: Date; totalAmountCents: number; paymentMethod: string | null; sellerId: string }>;
  salesCount: number;
  salesTotalCents: number;
  byMethod: CashByMethod;
  costTotalCents: number;
}

async function computeDay(tx: TenantScopedClient, storeId: string, date: string): Promise<DayTotals> {
  const { from, to } = dayRange(date);
  const sales = await tx.sale.findMany({
    where: { storeId, status: "completed", createdAt: { gte: from, lt: to } },
    select: { id: true, createdAt: true, totalAmountCents: true, paymentMethod: true, sellerId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const byMethod = emptyByMethod();
  let salesTotalCents = 0;
  for (const sale of sales) {
    byMethod[methodKey(sale.paymentMethod)] += sale.totalAmountCents;
    salesTotalCents += sale.totalAmountCents;
  }

  let costTotalCents = 0;
  if (sales.length) {
    const items = await tx.saleItem.findMany({
      where: { saleId: { in: sales.map((s) => s.id) } },
      select: { productId: true, quantity: true },
    });
    const products = await tx.product.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.productId))] } },
      select: { id: true, costPriceCents: true },
    });
    const costById = new Map(products.map((p) => [p.id, p.costPriceCents]));
    for (const item of items) costTotalCents += item.quantity * (costById.get(item.productId) ?? 0);
  }

  return { sales, salesCount: sales.length, salesTotalCents, byMethod, costTotalCents };
}

async function loadDay(tx: TenantScopedClient, tenantId: string, storeId: string, date: string): Promise<DayCash> {
  const store = await tx.store.findFirst({ where: { id: storeId }, select: { id: true, name: true } });
  if (!store) throw new NotFoundError("Loja não encontrada.");

  const totals = await computeDay(tx, storeId, date);
  const closing = await tx.cashClosing.findUnique({
    where: { tenantId_storeId_businessDate: { tenantId, storeId, businessDate: toDbDate(date) } },
  });
  const names = await userNames(tx, [closing?.closedBy, ...totals.sales.map((s) => s.sellerId)]);

  return {
    storeId: store.id,
    storeName: store.name,
    date,
    isToday: date === todayInCashTimezone(),
    salesCount: totals.salesCount,
    salesTotalCents: totals.salesTotalCents,
    byMethod: totals.byMethod,
    costTotalCents: totals.costTotalCents,
    profitCents: totals.salesTotalCents - totals.costTotalCents,
    sales: totals.sales.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      totalAmountCents: s.totalAmountCents,
      paymentMethod: methodKey(s.paymentMethod),
      sellerName: names.get(s.sellerId) ?? null,
    })),
    closing: closing
      ? {
          closedAt: closing.closedAt,
          closedByName: names.get(closing.closedBy) ?? null,
          notes: closing.notes,
          salesCount: closing.salesCount,
          salesTotalCents: closing.salesTotalCents,
        }
      : null,
    changedAfterClosing: Boolean(closing && (closing.salesCount !== totals.salesCount || closing.salesTotalCents !== totals.salesTotalCents)),
  };
}

// ---------------------------------------------------------------------------------------------
// API do módulo
// ---------------------------------------------------------------------------------------------

/** Caixa de um dia de uma loja (padrão: hoje). */
export async function getDayCash(tenantId: string, storeId: string, date?: string): Promise<DayCash> {
  const day = date ?? todayInCashTimezone();
  assertDate(day);
  return withTenant(tenantId, (tx) => loadDay(tx, tenantId, storeId, day));
}

/** Fecha (ou fecha de novo) o caixa do dia: grava a fotografia das vendas daquele dia. */
export async function closeDayCash(
  tenantId: string,
  userId: string,
  input: { storeId: string; date: string; notes?: string | undefined },
): Promise<DayCash> {
  assertDate(input.date);
  return withTenant(tenantId, async (tx) => {
    const store = await tx.store.findFirst({ where: { id: input.storeId }, select: { id: true } });
    if (!store) throw new NotFoundError("Loja não encontrada.");

    const totals = await computeDay(tx, input.storeId, input.date);
    const notes = input.notes?.trim() || null;
    const data = {
      salesCount: totals.salesCount,
      salesTotalCents: totals.salesTotalCents,
      costTotalCents: totals.costTotalCents,
      byMethod: totals.byMethod as unknown as Prisma.InputJsonValue,
      notes,
      closedBy: userId,
      closedAt: new Date(),
    };
    const key = { tenantId, storeId: input.storeId, businessDate: toDbDate(input.date) };
    const existing = await tx.cashClosing.findUnique({ where: { tenantId_storeId_businessDate: key }, select: { id: true } });
    const closing = await tx.cashClosing.upsert({
      where: { tenantId_storeId_businessDate: key },
      create: { ...key, ...data },
      update: data,
    });

    await recordAudit(tx, {
      tenantId,
      userId,
      entityType: "cash_closing",
      entityId: closing.id,
      action: existing ? "update" : "create",
      after: { storeId: input.storeId, date: input.date, salesCount: totals.salesCount, salesTotalCents: totals.salesTotalCents },
    });

    return loadDay(tx, tenantId, input.storeId, input.date);
  });
}

interface DayAggregateRow {
  storeId: string;
  day: string;
  salesCount: number;
  salesTotalCents: bigint | number;
}

/** Dias anteriores a hoje com venda e sem fechamento (ou alterados depois do fechamento). */
export async function listPendingCashDays(tenantId: string, storeId?: string): Promise<PendingCashDay[]> {
  const today = todayInCashTimezone();
  const lookback = addDays(today, -PENDING_LOOKBACK_DAYS);
  const firstDay = lookback > CASH_CLOSING_START_DATE ? lookback : CASH_CLOSING_START_DATE;
  if (firstDay >= today) return [];

  // sales.created_at é TIMESTAMP (sem fuso) gravado em UTC pelo Prisma: compara com texto UTC
  // (sem depender do TimeZone da sessão) e desloca 4h (CASH_TIMEZONE_OFFSET) para achar o dia em MS.
  const fromUtc = dayRange(firstDay).from.toISOString().replace("T", " ").replace("Z", "");
  const toUtc = dayRange(today).from.toISOString().replace("T", " ").replace("Z", "");

  return withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<DayAggregateRow[]>`
      SELECT store_id::text AS "storeId",
             to_char((created_at - interval '4 hours')::date, 'YYYY-MM-DD') AS "day",
             COUNT(*)::int AS "salesCount",
             COALESCE(SUM(total_amount_cents), 0)::bigint AS "salesTotalCents"
        FROM sales
       WHERE tenant_id = ${tenantId}::uuid
         AND status = 'completed'
         AND created_at >= ${fromUtc}::timestamp
         AND created_at < ${toUtc}::timestamp
         ${storeId ? Prisma.sql`AND store_id = ${storeId}::uuid` : Prisma.empty}
       GROUP BY 1, 2`;
    if (!rows.length) return [];

    const closings = await tx.cashClosing.findMany({
      where: { businessDate: { gte: toDbDate(firstDay), lt: toDbDate(today) }, ...(storeId ? { storeId } : {}) },
      select: { storeId: true, businessDate: true, salesCount: true, salesTotalCents: true },
    });
    const closingByKey = new Map(closings.map((c) => [`${c.storeId}|${fromDbDate(c.businessDate)}`, c]));
    const stores = await tx.store.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.storeId))] } }, select: { id: true, name: true } });
    const storeName = new Map(stores.map((s) => [s.id, s.name]));

    const pending: PendingCashDay[] = [];
    for (const row of rows) {
      const total = Number(row.salesTotalCents);
      const closing = closingByKey.get(`${row.storeId}|${row.day}`);
      if (closing && closing.salesCount === row.salesCount && closing.salesTotalCents === total) continue;
      pending.push({
        storeId: row.storeId,
        storeName: storeName.get(row.storeId) ?? "",
        date: row.day,
        salesCount: row.salesCount,
        salesTotalCents: total,
        changedAfterClosing: Boolean(closing),
      });
    }
    return pending.sort((a, b) => a.date.localeCompare(b.date) || a.storeName.localeCompare(b.storeName));
  });
}

/** Últimos fechamentos (mais recentes primeiro). */
export async function listCashClosings(tenantId: string, opts: { storeId?: string | undefined; limit?: number | undefined }): Promise<CashClosingListItem[]> {
  return withTenant(tenantId, async (tx) => {
    const closings = await tx.cashClosing.findMany({
      where: opts.storeId ? { storeId: opts.storeId } : {},
      include: { store: { select: { name: true } } },
      orderBy: [{ businessDate: "desc" }, { closedAt: "desc" }],
      take: opts.limit ?? 30,
    });
    const names = await userNames(tx, closings.map((c) => c.closedBy));
    return closings.map((c) => ({
      id: c.id,
      storeId: c.storeId,
      storeName: c.store.name,
      date: fromDbDate(c.businessDate),
      salesCount: c.salesCount,
      salesTotalCents: c.salesTotalCents,
      byMethod: parseByMethod(c.byMethod),
      costTotalCents: c.costTotalCents,
      profitCents: c.salesTotalCents - c.costTotalCents,
      closedAt: c.closedAt,
      closedByName: names.get(c.closedBy) ?? null,
      notes: c.notes,
    }));
  });
}

/** Tira custo e lucro de quem não tem acesso financeiro. */
export function hideCost<T extends { costTotalCents: number | null; profitCents: number | null }>(value: T, financial: boolean): T {
  return financial ? value : { ...value, costTotalCents: null, profitCents: null };
}
