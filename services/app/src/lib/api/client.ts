import type { ApiErrorBody } from "./types";

/**
 * Cliente HTTP fino para os Route Handlers do próprio app (`/api/**`, ver api/openapi/*.yaml).
 * Regra de fronteira (boundary-safety Pattern 1): usado APENAS para chamadas de API —
 * navegação entre páginas usa `<Link>`/`useRouter`, nunca este cliente.
 *
 * Sessão de tenant (Auth.js) e sessão de plataforma (`__Host-platform-session`) trafegam via
 * cookie httpOnly automaticamente (`credentials: "include"`) — nenhum token é lido/gravado
 * manualmente pelo cliente (evita XSS via localStorage, ver Common Mistakes do skill).
 */
export class ApiError extends Error {
  code: string;
  details: Record<string, unknown> | undefined;
  traceId: string;
  status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.traceId = body.trace_id;
  }
}

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const isFormData = body instanceof FormData;

  const mergedHeaders = new Headers(headers);
  if (!isFormData && !mergedHeaders.has("Content-Type")) {
    mergedHeaders.set("Content-Type", "application/json");
  }

  const init: RequestInit = {
    ...rest,
    credentials: "include",
    headers: mergedHeaders,
  };

  if (isFormData) {
    init.body = body as FormData;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(path, init);

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await res.json() : undefined;

  if (!res.ok) {
    if (payload && typeof payload === "object" && "code" in payload) {
      throw new ApiError(res.status, payload as ApiErrorBody);
    }
    throw new ApiError(res.status, {
      code: "UNKNOWN_ERROR",
      message: `Falha na requisição (${res.status})`,
      trace_id: "",
    });
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PUT", body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: "DELETE" }),
};
