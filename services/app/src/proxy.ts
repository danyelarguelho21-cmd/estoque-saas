// Next.js 16 renomeou middleware.ts -> proxy.ts (export `proxy` em vez de `middleware`) — ver
// https://nextjs.org/docs/messages/middleware-to-proxy. next-auth@5 oferece `auth` como a própria
// função de proxy: ela popula `req.auth` e permite redirecionar não-autenticados.
//
// Ação real de RBAC/tenant fica em requireSession()/requireRole() dentro de cada Route Handler
// (defesa em profundidade — boundary-safety Pattern 2: aqui só cuidamos do "está logado", nunca
// duplicamos a lógica de permissão por papel, que vive em modules/auth/rbac.ts).
//
// Nota: proxy roda em runtime Node.js por padrão no Next 16 — não definir `export const runtime`
// aqui (lançaria erro).
import { auth } from "@/modules/auth";
import { NextResponse } from "next/server";

const PUBLIC_API_PREFIXES = [
  "/api/healthz",
  "/api/readyz",
  "/api/auth", // login/signup/logout/NextAuth callback routes
  "/api/plans", // listagem pública de planos
  "/api/webhooks", // assinatura verificada dentro do handler, não por sessão
  "/api/platform-admin", // sessão própria (platformSessionCookie), fora do NextAuth
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }
  if (!req.auth) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Não autenticado.", trace_id: crypto.randomUUID() },
      { status: 401 },
    );
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/api/:path*"],
};
