// Next.js 16 renomeou middleware.ts -> proxy.ts (export `proxy` em vez de `middleware`) — ver
// https://nextjs.org/docs/messages/middleware-to-proxy (verificado via WebSearch, set/2026).
//
// Guarda de rotas — defesa em profundidade na borda; cada Route Handler/Server Component
// reforça a mesma regra (design-principles.md "zero-trust interno"). Três famílias de rota,
// nunca misturadas (boundary-safety Pattern 4 — o interceptor sempre branch por pathname, nunca
// retorna um resultado fixo independente do request):
//
// 1. `/api/*` — 401 JSON para requests sem sessão de tenant, exceto os prefixos públicos
//    (healthz/readyz, auth, plans, webhooks — assinatura própria — e platform-admin, que tem
//    sessão própria verificada no passo 3, não aqui).
// 2. `/admin/*` (exceto `/admin/entrar`) — sessão TOTALMENTE separada da de tenant, cookie
//    `__Host-platform-session`, nunca lida via NextAuth/`req.auth`.
// 3. Páginas de tenant (`/painel`, `/produtos`, `/estoque`, `/vendas`, `/configuracoes`,
//    `/assinatura`) — redireciona para `/entrar` preservando `callbackUrl` (Pattern 4 — nunca
//    hardcoded, sempre a partir do pathname real do request).
//
// Usamos `auth()` (de `@/modules/auth`) como wrapper — ele apenas decora `req.auth` quando uma
// sessão NextAuth válida existe; a decisão de autorização em si continua sendo feita abaixo,
// por branch explícito, então envolver TODAS as rotas (incluindo `/admin/*`) neste wrapper é
// seguro: `/admin/*` simplesmente ignora `req.auth` e verifica o cookie de plataforma direto.
//
// Nota: proxy roda em runtime Node.js por padrão no Next 16 — não definir `export const runtime`
// aqui (lançaria erro).
import { auth, isSubscriptionBlocked } from "@/modules/auth";
import { NextResponse } from "next/server";

const PUBLIC_API_PREFIXES = [
  "/api/healthz",
  "/api/readyz",
  "/api/auth", // login/signup/logout/NextAuth callback routes
  "/api/plans", // listagem pública de planos
  "/api/webhooks", // assinatura verificada dentro do handler, não por sessão
  "/api/platform-admin", // sessão própria (platformSessionCookie), fora do NextAuth
];

const TENANT_PROTECTED_PAGE_PREFIXES = [
  "/painel",
  "/produtos",
  "/estoque",
  "/vendas",
  "/configuracoes",
  "/assinatura",
];

// BUG FIX (2026-09-28, found live in production via manual test): a pending_payment tenant's
// page requests all passed this middleware fine (a valid session is a valid session) — only the
// underlying API calls each page makes were blocked (402, via requireSession/requireRole,
// modules/auth/rbac.ts). The PAGE SHELL (header, nav) rendered normally with every data widget
// silently failing underneath, which is indistinguishable from "it works" at a glance. Redirect
// to /assinatura here instead, same as the existing unauthenticated -> /entrar redirect below —
// consistent with how this middleware already handles "you can't be here."
const PAYMENT_EXEMPT_PAGE_PREFIXES = ["/assinatura"]; // must stay reachable to actually pay

export default auth(async (req) => {
  const { pathname } = req.nextUrl;

  // 0) Raiz: visitante vê a página comercial estática (public/site/index.html, servida via
  // rewrite para manter a URL "/"); usuário logado vai direto para o painel, como antes.
  if (pathname === "/") {
    if (req.auth) {
      return NextResponse.redirect(new URL("/painel", req.url));
    }
    return NextResponse.rewrite(new URL("/site/index.html", req.url));
  }

  // 1) API routes — 401 JSON, nunca redirect (o cliente é código, não um navegador com usuário).
  if (pathname.startsWith("/api/")) {
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
  }

  // 2) Painel administrativo interno — sessão própria, nunca via NextAuth.
  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/entrar") {
      return NextResponse.next();
    }
    const hasPlatformSession =
      req.cookies.has("__Host-platform-session") || req.cookies.has("platform-session-dev");
    // "platform-session-dev" é o nome usado em HTTP puro (localhost) por modules/admin/session.ts;
    // antes o proxy procurava "platform-session" e redirecionava o admin local de volta ao login.
    if (!hasPlatformSession) {
      return NextResponse.redirect(new URL("/admin/entrar", req.url));
    }
    return NextResponse.next();
  }

  // 3) Páginas de tenant — redireciona para login preservando destino.
  const isProtectedPage = TENANT_PROTECTED_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (isProtectedPage) {
    if (!req.auth) {
      const loginUrl = new URL("/entrar", req.url);
      loginUrl.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
      return NextResponse.redirect(loginUrl);
    }

    const isPaymentExempt = PAYMENT_EXEMPT_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
    if (!isPaymentExempt && req.auth.user?.tenantId && (await isSubscriptionBlocked(req.auth.user.tenantId))) {
      return NextResponse.redirect(new URL("/assinatura", req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/",
    "/api/:path*",
    "/painel/:path*",
    "/produtos/:path*",
    "/estoque/:path*",
    "/vendas/:path*",
    "/configuracoes/:path*",
    "/assinatura/:path*",
    "/admin/:path*",
  ],
};
