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
import type { Role } from "@estoque-saas/shared";
import { verifyLoginCredentials } from "./login";

const isProduction = process.env.NODE_ENV === "production";

// AUTH_SECRET ausente derruba o boot (fail fast) em vez de rodar com sessão insegura/sem
// assinatura — mesma postura de PagBankProvider (ver pagbank.ts).
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) {
  throw new Error("AUTH_SECRET ausente — configure em .env (ver .env.example).");
}

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
      name: isProduction ? "__Host-session" : "session-dev",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
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
  secret: authSecret,
});
