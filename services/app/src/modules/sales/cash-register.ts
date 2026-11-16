// Fechamento de caixa diário por loja.
//
// Fluxo: abrir caixa (loja + troco inicial) -> sangrias/suprimentos -> fechar (valores contados).
// As vendas de um caixa são as vendas CONCLUÍDAS da loja entre a abertura e o fechamento
// (janela de tempo, de qualquer vendedor). Vendas lançadas com data passada caem fora da janela.
//
// Regras de acesso (aplicadas pelos Route Handlers via toCashSessionView):
//   - admin/operador, ou vendedor com a senha do gestor liberada (hasFinancialAccess): veem tudo.
//   - vendedor sem a senha: opera o caixa, mas o fechamento é "cego" — nunca recebe esperado,
//     diferença, totais de vendas nem a lista de vendas do período.
//
// Concorrência: "um caixa aberto por loja" é garantido no banco pelo índice único parcial
// cash_sessions_one_open_per_store. Sangria/suprimento/fechamento travam a linha do caixa
// (SELECT ... FOR UPDATE) para que um lançamento não entre num caixa que está sendo fechado.
import { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError, recordAudit, withTenant, type TenantScopedClient } from "@estoque-saas/shared";
import {
  computeCashDifferences,
  computeCashSummary,
  parseStoredSummary,
  type CashDifferences,
  type CashSummary,
} from "./cash-summary";

const CASH_TIMEZONE_OFFSET = "-04:00"; // America/Campo_Grande (sem horário de verão) — mesmo de sales.ts
const CASH_TIMEZONE = "America/Campo_Grande";
const MAX_SALES_IN_DETAIL = 1000;

export type CashMovementType = "sangria" | "suprimento";

export interface OpenCashSessionInput {
  storeId: string;
  openingAmountCents: number;
}

export interface CashMovementInput {
  type: CashMovementType;
  amountCents: number;
  reason: string;
}

export interface CloseCashSessionInput {
  countedCashCents: number;
  countedPixCents?: number | undefined;
  countedDebitCents?: number | undefined;
  countedCreditCents?: number | undefined;
  notes?: string | undefined;
}

export interface CashMovementView {
  id: string;
  type: CashMovementType;
  amountCents: number;
  reason: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: Date;
}

export interface CashSaleView {
  id: string;
  createdAt: Date;
  totalAmountCents: number;
  paymentMethod: string | null;
  paymentMethodLabel: string | null;
  sellerId: string;
  sellerName: string | null;
}

export interface CashSessionDetail {
  id: string;
  storeId: string;
  storeName: string;
  status: "open" | "closed";
  openingAmountCents: number;
  openedBy: string;
  openedByName: string | null;
  openedAt: Date;
  closedBy: string | null;
  closedByName: string | null;
  closedAt: Date | null;
  countedCashCents: number | null;
  countedPixCents: number | null;
  countedDebitCents: number | null;
  countedCreditCents: number | null;
  notes: string | null;
  movements: CashMovementView[];
  summary: CashSummary;
  differences: CashDifferences | null;
  sales: CashSaleView[];
}

/** O que a API devolve: com `financial=false` os campos de conferência são omitidos. */
export type CashSessionView = Omit<CashSessionDetail, "summary" | "differences" | "sales"> & {
  financial: boolean;
  summary?: CashSummary;
  differences?: CashDifferences | null;
  sales?: CashSaleView[];
};

export function toCashSessionView(detail: CashSessionDetail, financial: boolean): CashSessionView {
  if (financial) return { ...detail, financial: true };
  const { summary: _summary, differences: _differences, sales: _sales, ...rest } = detail;
  return { ...rest, financial: false };
}

// ---------------------------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function assertCents(value: number | undefined, field: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) throw new ValidationError(`Valor inválido em ${field}.`);
}

async function lockSession(tx: TenantScopedClient, sessionId: string) {
  // RLS se aplica ao SELECT ... FOR UPDATE também: caixa de outro tenant simplesmente não aparece.
  await tx.$queryRaw`SELECT id FROM cash_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
  const session = await tx.cashSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new NotFoundError("Caixa não encontrado.");
  return session;
}

async function userNames(tx: TenantScopedClient, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

async function salesInWindow(tx: TenantScopedClient, storeId: string, from: Date, to: Date) {
  return tx.sale.findMany({
    where: { storeId, status: "completed", createdAt: { gte: from, lte: to } },
    select: { id: true, createdAt: true, totalAmountCents: true, paymentMethod: true, paymentMethodLabel: true, sellerId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

function countedOf(session: {
  countedCashCents: number | null;
  countedPixCents: number | null;
  countedDebitCents: number | null;
  countedCreditCents: number | null;
}) {
  return {
    countedCashCents: session.countedCashCents,
    countedPixCents: session.countedPixCents,
    countedDebitCents: session.countedDebitCents,
    countedCreditCents: session.countedCreditCents,
  };
}

async function loadDetail(tx: TenantScopedClient, sessionId: string): Promise<CashSessionDetail> {
  const session = await tx.cashSession.findUnique({
    where: { id: sessionId },
    include: { store: { select: { name: true } }, movements: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!session) throw new NotFoundError("Caixa não encontrado.");

  const windowEnd = session.closedAt ?? new Date();
  const sales = await salesInWindow(tx, session.storeId, session.openedAt, windowEnd);

  // Caixa fechado: usa a "fotografia" gravada no fechamento. Aberto: calcula na hora.
  const stored = session.status === "closed" ? parseStoredSummary(session.summary) : null;
  const summary =
    stored ??
    computeCashSummary({ openingAmountCents: session.openingAmountCents, sales, movements: session.movements });

  const names = await userNames(tx, [
    session.openedBy,
    session.closedBy,
    ...session.movements.map((m) => m.createdBy),
    ...sales.map((s) => s.sellerId),
  ]);

  return {
    id: session.id,
    storeId: session.storeId,
    storeName: session.store.name,
    status: session.status === "closed" ? "closed" : "open",
    openingAmountCents: session.openingAmountCents,
    openedBy: session.openedBy,
    openedByName: names.get(session.openedBy) ?? null,
    openedAt: session.openedAt,
    closedBy: session.closedBy,
    closedByName: session.closedBy ? (names.get(session.closedBy) ?? null) : null,
    closedAt: session.closedAt,
    ...countedOf(session),
    notes: session.notes,
    movements: session.movements.map((m) => ({
      id: m.id,
      type: m.type === "sangria" ? "sangria" : "suprimento",
      amountCents: m.amountCents,
      reason: m.reason,
      createdBy: m.createdBy,
      createdByName: names.get(m.createdBy) ?? null,
      createdAt: m.createdAt,
    })),
    summary,
    differences: session.status === "closed" ? computeCashDifferences(summary, countedOf(session)) : null,
    sales: sales.slice(0, MAX_SALES_IN_DETAIL).map((s) => ({ ...s, sellerName: names.get(s.sellerId) ?? null })),
  };
}

// ---------------------------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------------------------

export async function openCashSession(tenantId: string, userId: string, input: OpenCashSessionInput): Promise<CashSessionDetail> {
  assertCents(input.openingAmountCents, "troco inicial");
  try {
    return await withTenant(tenantId, async (tx) => {
      const store = await tx.store.findUnique({ where: { id: input.storeId }, select: { id: true } });
      if (!store) throw new NotFoundError("Loja não encontrada.");

      const alreadyOpen = await tx.cashSession.findFirst({ where: { storeId: input.storeId, status: "open" }, select: { id: true } });
      if (alreadyOpen) throw new ConflictError("Já existe um caixa aberto nesta loja.", { cashSessionId: alreadyOpen.id });

      const session = await tx.cashSession.create({
        data: { tenantId, storeId: input.storeId, status: "open", openingAmountCents: input.openingAmountCents, openedBy: userId },
      });
      await recordAudit(tx, {
        tenantId,
        userId,
        entityType: "cash_session",
        entityId: session.id,
        action: "create",
        after: { storeId: input.storeId, openingAmountCents: input.openingAmountCents },
      });
      return loadDetail(tx, session.id);
    });
  } catch (err) {
    // Duas aberturas simultâneas: a segunda bate no índice único parcial.
    if (isUniqueViolation(err)) throw new ConflictError("Já existe um caixa aberto nesta loja.");
    throw err;
  }
}

export async function addCashMovement(
  tenantId: string,
  userId: string,
  sessionId: string,
  input: CashMovementInput,
): Promise<CashMovementView> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new ValidationError("Informe um valor maior que zero.");
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError("Informe o motivo.");

  return withTenant(tenantId, async (tx) => {
    const session = await lockSession(tx, sessionId);
    if (session.status !== "open") throw new ConflictError("Este caixa já foi fechado.");

    const movement = await tx.cashMovement.create({
      data: { tenantId, cashSessionId: sessionId, type: input.type, amountCents: input.amountCents, reason, createdBy: userId },
    });
    await recordAudit(tx, {
      tenantId,
      userId,
      entityType: "cash_movement",
      entityId: movement.id,
      action: "create",
      after: { cashSessionId: sessionId, type: input.type, amountCents: input.amountCents, reason },
    });
    const names = await userNames(tx, [userId]);
    return {
      id: movement.id,
      type: input.type,
      amountCents: movement.amountCents,
      reason: movement.reason,
      createdBy: userId,
      createdByName: names.get(userId) ?? null,
      createdAt: movement.createdAt,
    };
  });
}

export async function closeCashSession(
  tenantId: string,
  userId: string,
  sessionId: string,
  input: CloseCashSessionInput,
): Promise<CashSessionDetail> {
  assertCents(input.countedCashCents, "dinheiro contado");
  assertCents(input.countedPixCents, "Pix conferido");
  assertCents(input.countedDebitCents, "cartão de débito conferido");
  assertCents(input.countedCreditCents, "cartão de crédito conferido");

  return withTenant(tenantId, async (tx) => {
    const session = await lockSession(tx, sessionId);
    if (session.status !== "open") throw new ConflictError("Este caixa já foi fechado.");

    const closedAt = new Date();
    const [sales, movements] = await Promise.all([
      salesInWindow(tx, session.storeId, session.openedAt, closedAt),
      tx.cashMovement.findMany({ where: { cashSessionId: sessionId }, select: { type: true, amountCents: true } }),
    ]);
    const summary = computeCashSummary({ openingAmountCents: session.openingAmountCents, sales, movements });
    const counted = {
      countedCashCents: input.countedCashCents,
      countedPixCents: input.countedPixCents ?? null,
      countedDebitCents: input.countedDebitCents ?? null,
      countedCreditCents: input.countedCreditCents ?? null,
    };
    const differences = computeCashDifferences(summary, counted);
    const notes = input.notes?.trim() || null;

    await tx.cashSession.update({
      where: { id: sessionId },
      data: {
        status: "closed",
        closedBy: userId,
        closedAt,
        ...counted,
        expectedCashCents: summary.expectedCashCents,
        salesTotalCents: summary.salesTotalCents,
        salesCount: summary.salesCount,
        summary: summary as unknown as Prisma.InputJsonValue,
        notes,
      },
    });
    await recordAudit(tx, {
      tenantId,
      userId,
      entityType: "cash_session",
      entityId: sessionId,
      action: "update",
      before: { status: "open" },
      after: {
        status: "closed",
        ...counted,
        expectedCashCents: summary.expectedCashCents,
        cashDifferenceCents: differences.cash,
        salesTotalCents: summary.salesTotalCents,
        salesCount: summary.salesCount,
      },
    });
    return loadDetail(tx, sessionId);
  });
}

export async function getCashSession(tenantId: string, sessionId: string): Promise<CashSessionDetail> {
  return withTenant(tenantId, (tx) => loadDetail(tx, sessionId));
}

export interface OpenCashSessionListItem {
  id: string;
  storeId: string;
  storeName: string;
  openingAmountCents: number;
  openedBy: string;
  openedByName: string | null;
  openedAt: Date;
  movementCount: number;
}

export async function listOpenCashSessions(tenantId: string, storeId?: string): Promise<OpenCashSessionListItem[]> {
  return withTenant(tenantId, async (tx) => {
    const sessions = await tx.cashSession.findMany({
      where: { status: "open", ...(storeId ? { storeId } : {}) },
      include: { store: { select: { name: true } }, _count: { select: { movements: true } } },
      orderBy: { openedAt: "asc" },
    });
    const names = await userNames(tx, sessions.map((s) => s.openedBy));
    return sessions.map((s) => ({
      id: s.id,
      storeId: s.storeId,
      storeName: s.store.name,
      openingAmountCents: s.openingAmountCents,
      openedBy: s.openedBy,
      openedByName: names.get(s.openedBy) ?? null,
      openedAt: s.openedAt,
      movementCount: s._count.movements,
    }));
  });
}

export interface ClosedCashSessionFilters {
  storeId?: string | undefined;
  /** AAAA-MM-DD (dia de abertura, fuso de MS). */
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function listClosedCashSessions(tenantId: string, filters: ClosedCashSessionFilters) {
  const limit = filters.limit ?? 20;
  return withTenant(tenantId, async (tx) => {
    const sessions = await tx.cashSession.findMany({
      where: {
        status: "closed",
        ...(filters.storeId ? { storeId: filters.storeId } : {}),
        ...(filters.from || filters.to
          ? {
              openedAt: {
                ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00${CASH_TIMEZONE_OFFSET}`) } : {}),
                ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999${CASH_TIMEZONE_OFFSET}`) } : {}),
              },
            }
          : {}),
      },
      include: { store: { select: { name: true } } },
      orderBy: [{ closedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = sessions.length > limit;
    const page = hasMore ? sessions.slice(0, limit) : sessions;
    const names = await userNames(tx, page.flatMap((s) => [s.openedBy, s.closedBy]));

    return {
      items: page.map((s) => {
        const summary = parseStoredSummary(s.summary);
        const differences = summary ? computeCashDifferences(summary, countedOf(s)) : null;
        return {
          id: s.id,
          storeId: s.storeId,
          storeName: s.store.name,
          openedAt: s.openedAt,
          openedByName: names.get(s.openedBy) ?? null,
          closedAt: s.closedAt,
          closedByName: s.closedBy ? (names.get(s.closedBy) ?? null) : null,
          salesCount: s.salesCount ?? 0,
          salesTotalCents: s.salesTotalCents ?? 0,
          expectedCashCents: s.expectedCashCents,
          countedCashCents: s.countedCashCents,
          cashDifferenceCents: differences?.cash ?? null,
          totalDifferenceCents: differences?.total ?? null,
        };
      }),
      page: { next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null, has_more: hasMore },
    };
  });
}

export interface TodayCashStatus {
  storeId: string;
  storeName: string;
  status: "open" | "closed" | "none";
  sessionId: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
  cashDifferenceCents: number | null;
  totalDifferenceCents: number | null;
}

function startOfTodayInCashTimezone(): Date {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: CASH_TIMEZONE }).format(new Date());
  return new Date(`${today}T00:00:00${CASH_TIMEZONE_OFFSET}`);
}

/** Situação do caixa de hoje por loja: aberto, fechado hoje (com diferença) ou não aberto. */
export async function getTodayCashStatus(tenantId: string, storeId?: string): Promise<TodayCashStatus[]> {
  const startOfToday = startOfTodayInCashTimezone();
  return withTenant(tenantId, async (tx) => {
    const stores = await tx.store.findMany({
      where: storeId ? { id: storeId } : {},
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const sessions = await tx.cashSession.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        OR: [{ status: "open" }, { closedAt: { gte: startOfToday } }],
      },
      orderBy: [{ openedAt: "desc" }, { id: "desc" }],
    });

    return stores.map((store): TodayCashStatus => {
      const ofStore = sessions.filter((s) => s.storeId === store.id);
      const session = ofStore.find((s) => s.status === "open") ?? ofStore.find((s) => s.status === "closed") ?? null;
      if (!session) {
        return { storeId: store.id, storeName: store.name, status: "none", sessionId: null, openedAt: null, closedAt: null, cashDifferenceCents: null, totalDifferenceCents: null };
      }
      const summary = session.status === "closed" ? parseStoredSummary(session.summary) : null;
      const differences = summary ? computeCashDifferences(summary, countedOf(session)) : null;
      return {
        storeId: store.id,
        storeName: store.name,
        status: session.status === "closed" ? "closed" : "open",
        sessionId: session.id,
        openedAt: session.openedAt,
        closedAt: session.closedAt,
        cashDifferenceCents: differences?.cash ?? null,
        totalDifferenceCents: differences?.total ?? null,
      };
    });
  });
}
