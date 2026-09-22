import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Guarda de rotas — defesa em profundidade na borda (o Route Handler reforça a mesma regra,
 * ver design-principles.md "zero-trust interno"). Duas famílias de sessão, nunca misturadas:
 *
 * 1. Rotas de tenant (`/painel`, `/produtos`, `/estoque`, `/vendas`, `/configuracoes`,
 *    `/assinatura`) — usa `getToken` (next-auth/jwt), edge-safe, NÃO importa `services/app/src/
 *    modules/auth` (evita acoplamento de compilação com o módulo que o Software Engineer
 *    implementa em paralelo — ver 01-analysis.md). Redireciona para `/entrar` preservando
 *    `callbackUrl` (Pattern 4 — nunca hardcoded).
 * 2. Rotas administrativas (`/admin/*`, exceto `/admin/entrar`) — sessão TOTALMENTE separada,
 *    cookie `__Host-platform-session`, sem relação com Auth.js.
 *
 * Convenção `proxy.ts` (renomeada de `middleware.ts` no Next.js 16 — verificado via WebSearch,
 * set/2026: nextjs.org/docs/messages/middleware-to-proxy). Mesma API, só o nome do arquivo e da
 * função exportada mudou; `config.matcher` permanece igual.
 */
const TENANT_PROTECTED_PREFIXES = ["/painel", "/produtos", "/estoque", "/vendas", "/configuracoes", "/assinatura"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin/entrar") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    const hasPlatformSession =
      request.cookies.has("__Host-platform-session") || request.cookies.has("platform-session");
    if (!hasPlatformSession) {
      const loginUrl = new URL("/admin/entrar", request.url);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  const isProtected = TENANT_PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isProtected) {
    return NextResponse.next();
  }

  const secret = process.env.AUTH_SECRET;
  const token = await getToken(secret ? { req: request, secret } : { req: request });
  if (!token) {
    const loginUrl = new URL("/entrar", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/painel/:path*",
    "/produtos/:path*",
    "/estoque/:path*",
    "/vendas/:path*",
    "/configuracoes/:path*",
    "/assinatura/:path*",
    "/admin/:path*",
  ],
};
