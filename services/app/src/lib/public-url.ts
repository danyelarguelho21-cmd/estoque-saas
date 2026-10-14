// URL pública do sistema para montar links enviados por e-mail (convites etc.).
// Em produção vem de AUTH_URL (https://usezolo.com.br); sem ela, usa a origem do próprio request.
export function publicBaseUrl(req: Request): string {
  const configured = process.env.AUTH_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(req.url).origin;
}
