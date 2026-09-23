// Helper de resposta HTTP para Route Handlers (Next.js App Router) — formato de erro padrão
// {code, message, details, trace_id} (api/openapi/_common.yaml#/components/schemas/Error).
// Infraestrutura pura, sem lógica de domínio — por isso vive em src/lib, não em modules/*
// (módulos de domínio importam ISTO, nunca o contrário).
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppError, NotFoundError, toErrorResponse, ValidationError } from "@estoque-saas/shared";
import type { ZodType } from "zod";

// qa-engineer finding H-1: `findUniqueOrThrow`/`findFirstOrThrow` on any RLS-scoped id that
// belongs to another tenant (RLS makes the row invisible, not "absent with a different owner")
// or simply doesn't exist throws Prisma's P2025 — which, uncaught, fell through to the generic
// 500 branch below instead of the 404 the NotFound contract (_common.yaml) requires. Mapped
// centrally here (not by touching each of the ~6 call sites) so every current AND future
// find*OrThrow call gets this translation for free.
function isPrismaNotFoundError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export function ok<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

export function created<T>(data: T): Response {
  return ok(data, 201);
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function accepted<T>(data: T): Response {
  return ok(data, 202);
}

// Valida o corpo JSON da requisição contra um schema Zod, lançando ValidationError (400, formato
// padrão da API) em vez do erro cru do Zod — usado por todo Route Handler que recebe body.
export async function parseJsonBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError("Corpo da requisição precisa ser JSON válido.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError("Dados inválidos.", { issues: result.error.issues });
  }
  return result.data;
}

// Mesma ideia de parseJsonBody, mas para query string (?a=1&b=2) — usado por todo Route Handler
// GET com filtros/paginação.
export function parseQuery<T>(searchParams: URLSearchParams, schema: ZodType<T>): T {
  const raw: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    raw[key] = value;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError("Parâmetros de busca inválidos.", { issues: result.error.issues });
  }
  return result.data;
}

// Envolve o handler de domínio: qualquer AppError lançado é traduzido para o formato de erro
// padrão; erros desconhecidos nunca vazam detalhe interno (toErrorResponse cuida disso).
export async function handleRoute(fn: () => Promise<Response>): Promise<Response> {
  const traceId = randomUUID();
  try {
    return await fn();
  } catch (rawErr) {
    // P2025 (Prisma's findUniqueOrThrow/findFirstOrThrow "no record found") is an expected,
    // routine outcome under RLS — not an internal error — so it's translated to NotFoundError
    // BEFORE the AppError check below, same as any other domain-level 404.
    const err = isPrismaNotFoundError(rawErr) ? new NotFoundError("Recurso não encontrado.") : rawErr;

    // Erros esperados (AppError) não vazam detalhe nem precisam de log de alarme — são fluxo de
    // negócio normal (404, 409, etc). Erros DESCONHECIDOS são logados server-side com trace_id
    // para correlação (nunca expostos ao cliente — toErrorResponse já garante isso), senão ficam
    // invisíveis (achado rodando o boot-smoke real: sem isto, uma falha virava um 500 silencioso,
    // sem nenhum rastro em log algum).
    if (!(err instanceof AppError)) {
      console.error(`[handleRoute] erro não tratado (trace_id=${traceId}):`, err);
    }
    const { status, body } = toErrorResponse(err, traceId);
    return Response.json(body, { status });
  }
}
