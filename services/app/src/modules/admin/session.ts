// Sessão do painel administrativo interno — DELIBERADAMENTE separada do Auth.js/NextAuth usado
// pelos usuários de tenant (ADR de design-principles.md — zero-trust interno: comprometer a
// sessão de um tenant nunca deve dar acesso ao painel do dono da plataforma, e vice-versa).
// Implementação própria (token assinado HMAC-SHA256), não NextAuth — evitar duas instâncias de
// NextAuth coexistindo no mesmo app é mais simples e deixa a fronteira de confiança explícita.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { isSecureDeployment } from "@estoque-saas/shared";

// isSecureDeployment() (não NODE_ENV) — ver libs/shared/src/config/secure-cookies.ts para o porquê
// (bug real: __Host-/Secure sobre HTTP puro faz o navegador descartar o cookie silenciosamente).
const isSecure = isSecureDeployment();
const COOKIE_NAME = isSecure ? "__Host-platform-session" : "platform-session-dev";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function getSecret(): string {
  const secret = process.env.PLATFORM_ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("PLATFORM_ADMIN_SESSION_SECRET ausente — configure em .env (ver .env.example).");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export async function createPlatformSession(adminId: string): Promise<void> {
  const payload = JSON.stringify({ adminId, exp: Date.now() + SESSION_TTL_MS });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const signature = sign(encoded);
  const token = `${encoded}.${signature}`;

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecure,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroyPlatformSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getPlatformSession(): Promise<{ adminId: string } | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expectedSignature = sign(encoded);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expectedSignature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { adminId: string; exp: number };
    if (payload.exp < Date.now()) return null;
    return { adminId: payload.adminId };
  } catch {
    return null;
  }
}
