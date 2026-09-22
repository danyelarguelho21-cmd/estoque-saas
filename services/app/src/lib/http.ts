// Helper de resposta HTTP para Route Handlers (Next.js App Router) — formato de erro padrão
// {code, message, details, trace_id} (api/openapi/_common.yaml#/components/schemas/Error).
// Infraestrutura pura, sem lógica de domínio — por isso vive em src/lib, não em modules/*
// (módulos de domínio importam ISTO, nunca o contrário).
import { randomUUID } from "node:crypto";
import { AppError, toErrorResponse, ValidationError } from "@estoque-saas/shared";
import type { ZodType } from "zod";

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
  } catch (err) {
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
