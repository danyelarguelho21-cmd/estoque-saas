// Auth.js v5 (next-auth@5) — sessão de usuários de tenant (admin/operador/vendedor).
// Cookie __Host-session (api/openapi/_common.yaml#sessionCookie) — __Host- exige Secure, então só
// é usado em produção; em desenvolvimento (HTTP local) usamos um nome de cookie sem o prefixo para
// permitir testar localmente (boundary-safety Pattern 1 — não usar uma abstração que assume HTTPS
// onde o ambiente não garante isso).
//
// pages.signIn aponta para a PÁGINA de login (/login), nunca para /api/auth/signin — apontar para
// a própria rota de callback do NextAuth criaria um redirect loop (boundary-safety Pattern 3).
import NextAuth, { type NextAuthResult } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { isSecureDeployment, type Role } from "@estoque-saas/shared";
import { verifyLoginCredentials } from "./login";

// isSecureDeployment() (não NODE_ENV) — ver libs/shared/src/config/secure-cookies.ts para o porquê.
const isSecure = isSecureDeployment();

// AUTH_SECRET ausente deve derrubar uma tentativa REAL de login (fail fast em runtime) em vez de
// rodar com sessão insegura/sem assinatura — mesma postura de PagBankProvider (ver
// billing/provider.ts) e platform-admin session (ver admin/session.ts).
//
// IMPORTANTE: a checagem NÃO pode lançar no escopo do módulo (top-level). Este arquivo é
// importado por toda rota autenticada (direto ou via modules/auth/index.ts) e por proxy.ts; o
// `next build` avalia esses módulos durante "Collecting page data" para decidir static vs
// dynamic, SEM nenhuma env var de runtime disponível — isso derruba o build inteiro mesmo em
// ambientes onde o container final terá AUTH_SECRET configurado via docker-compose `env_file`
// (bug real encontrado rodando `docker compose up --build` de verdade nesta fase). A checagem
// portanto vive dentro de `authorize()`, que só roda numa tentativa de login de fato.
const authSecret = process.env.AUTH_SECRET;

export const { handlers, auth, signIn, signOut }: NextAuthResult = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  // api/openapi/auth.yaml define /api/auth/login, /api/auth/logout e /api/auth/signup como rotas
  // PRÓPRIAS (contrato da API, não as rotas default do NextAuth). Para não colidir, o catch-all
  // interno do NextAuth (sessão/callback/csrf) é montado em um basePath separado — ver
  // src/app/api/auth/nextauth-internal/[...nextauth]/route.ts.
  basePath: "/api/auth/nextauth-internal",
  cookies: {
    sessionToken: {
      name: isSecure ? "__Host-session" : "session-dev",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isSecure,
      },
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "email", type: "email" },
        password: { label: "password", type: "password" },
      },
      async authorize(credentials) {
        // Checagem lazy (ver comentário acima de `authSecret`) — só roda numa tentativa de login
        // de fato, nunca durante `next build`. Se isto disparar em produção, o deploy está
        // misconfigured (AUTH_SECRET não chegou ao container) — melhor um 401/erro claro aqui do
        // que emitir uma sessão assinada com o placeholder de build.
        if (!authSecret) {
          throw new Error("AUTH_SECRET ausente — configure em .env (ver .env.example).");
        }

        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        const user = await verifyLoginCredentials(email, password);
        if (!user) return null;

        return {
          id: user.userId,
          email,
          name: user.name,
          tenantId: user.tenantId,
          tenantName: user.tenantName,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.tenantId = (user as { tenantId: string }).tenantId;
        token.tenantName = (user as { tenantName: string }).tenantName;
        token.role = (user as { role: Role }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        // Sobrescrever o callback `session` default do NextAuth significa reimplementar TUDO que
        // ele faria por padrão — inclusive popular session.user.id a partir de token.sub. Sem
        // isto, session.user.id fica undefined, e requireSession() (rbac.ts) caía para "" (string
        // vazia) como userId — que quebra em runtime ao gravar em qualquer coluna @db.Uuid (ex:
        // audit_log.user_id), erro só visível rodando uma mutação autenticada de verdade contra
        // Postgres real (não pego por typecheck, já que `string | undefined` aceita "").
        session.user.id = token.sub as string;
        session.user.tenantId = token.tenantId as string;
        session.user.tenantName = token.tenantName as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
  // Fallback só é usado quando authSecret está ausente (build-time do `next build`, ou runtime
  // misconfigured). NextAuth exige `secret` tipado como string não-opcional; o valor real de
  // produção SEMPRE sobrescreve isto via env var. Nenhuma sessão real chega a ser emitida com o
  // placeholder — `authorize()` acima lança antes de retornar um usuário, então o NextAuth nunca
  // assina um JWT de sessão de verdade com este valor.
  secret: authSecret ?? "build-time-placeholder-never-used-to-sign-real-sessions",
});
