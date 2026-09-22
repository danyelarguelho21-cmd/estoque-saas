// Hierarquia de erros de domínio + formato de resposta de erro padrão da API
// ({code, message, details, trace_id} — ver api/openapi/_common.yaml#/components/schemas/Error).
// Toda camada de domínio (modules/*) lança AppError (ou subclasse); a camada HTTP
// (Route Handlers) é a única responsável por traduzir para status code + JSON.

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PLAN_LIMIT_REACHED"
  | "PAYMENT_REQUIRED"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PLAN_LIMIT_REACHED: 409,
  PAYMENT_REQUIRED: 402,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Não autenticado.") {
    super("UNAUTHORIZED", message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Sem permissão para esta ação.") {
    super("FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso não encontrado.") {
    super("NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFLICT", message, details);
    this.name = "ConflictError";
  }
}

export class PlanLimitReachedError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PLAN_LIMIT_REACHED", message, details);
    this.name = "PlanLimitReachedError";
  }
}

export class PaymentRequiredError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PAYMENT_REQUIRED", message, details);
    this.name = "PaymentRequiredError";
  }
}

export interface ErrorResponseBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  trace_id: string;
}

// Traduz qualquer erro (AppError ou desconhecido) para o formato de resposta padrão.
// Nunca vaza stack trace / mensagem interna de erros desconhecidos ao cliente.
export function toErrorResponse(err: unknown, traceId: string): { status: number; body: ErrorResponseBody } {
  if (err instanceof AppError) {
    const body: ErrorResponseBody = {
      code: err.code,
      message: err.message,
      trace_id: traceId,
    };
    if (err.details) {
      body.details = err.details;
    }
    return { status: err.status, body };
  }
  return {
    status: 500,
    body: { code: "INTERNAL_ERROR", message: "Erro interno inesperado.", trace_id: traceId },
  };
}
