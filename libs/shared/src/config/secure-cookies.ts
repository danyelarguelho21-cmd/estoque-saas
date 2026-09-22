// Decide se cookies de sessão devem usar `Secure`/prefixo `__Host-` — usado por
// services/app/src/modules/auth/auth.config.ts (sessão de tenant) e
// services/app/src/modules/admin/session.ts (sessão do painel administrativo).
//
// NÃO usar `NODE_ENV === "production"` para isso (bug real encontrado testando via Docker Compose
// de verdade): o Dockerfile de produção sempre roda com NODE_ENV=production, mas o alvo de deploy
// atual (VPS via Docker Compose, ver ADR-001/docs/architecture/deployment-notes.md) NÃO tem TLS
// na frente ainda — reverse proxy/HTTPS é um follow-up explícito do SHIP. `NODE_ENV=production` +
// `Secure`/`__Host-` sobre HTTP puro faz o navegador simplesmente DESCARTAR o cookie no Set-Cookie
// (comportamento padrão de todo navegador para o atributo `Secure` — RFC 6265bis), quebrando login
// silenciosamente: a resposta HTTP parece 200 OK, mas a sessão nunca fica gravada no browser.
//
// Deriva de AUTH_URL (já obrigatória para o NextAuth `trustHost`) — reflete o protocolo real que o
// app está publicamente servido, não o modo de build do Node.
export function isSecureDeployment(): boolean {
  const url = process.env.AUTH_URL ?? "";
  return url.startsWith("https://");
}
