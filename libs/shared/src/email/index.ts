import { Resend } from "resend";

// Remetente fixo — único usado hoje (boas-vindas e confirmação de pagamento). Se surgir um
// segundo remetente/domínio, promova para um campo em SendEmailInput em vez de um segundo
// hardcode aqui.
const FROM_ADDRESS = "Zolo <naoresponda@usezolo.com.br>";

// Construído lazily (não no import-time) pelo mesmo motivo de getPaymentProvider
// (services/app/src/modules/billing/provider.ts) — ambientes sem RESEND_API_KEY configurada
// (testes unitários de outras partes do sistema) não podem derrubar o processo só por importar
// este módulo.
let cached: Resend | null = null;
function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  cached ??= new Resend(apiKey);
  return cached;
}

// Nunca loga o e-mail completo (mesmo princípio de nunca logar CPF/CNPJ/senha — ver
// security-engineer findings da auditoria) — só o suficiente pra correlacionar em suporte.
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

// Escapa texto controlado pelo usuário (nome, razão social — sem restrição de caracteres no Zod
// de signup, ver services/app/src/app/api/auth/signup/route.ts) antes de interpolar num corpo de
// e-mail HTML. Sem isto, um cadastro com companyName tipo `<img src=x onerror=...>` injetaria
// markup arbitrário no e-mail entregue ao próprio usuário.
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// O SDK do Resend não aceita AbortSignal em `emails.send()` (conferido em
// node_modules/resend/dist/index.d.mts — CreateEmailRequestOptions só tem query/headers), então
// não dá para cancelar a requisição HTTP subjacente como pagbankFetch faz. Mas Promise.race
// garante que sendTransactionalEmail em si NUNCA segura o cadastro/webhook além deste limite,
// mesmo com uma chave presente-porém-inválida (ex: RESEND_API_KEY=dev-placeholder em dev local)
// contra uma rede lenta/inacessível — sem isto, essa chamada não teria timeout nenhum.
const EMAIL_REQUEST_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Resend não respondeu em ${ms}ms`)), ms)),
  ]);
}

// E-mail transacional best-effort via Resend — NUNCA lança. Cadastro (modules/auth/signup) e
// processamento de webhook (modules/billing/webhook) não podem depender de um provedor de e-mail
// terceiro para completar — mesmo espírito de isolamento de falha do resto do sistema
// (generate-monthly-charge isola por tenant, processNfeImportJob isola por XML malformado). Sem
// RESEND_API_KEY configurada (dev/sandbox/testes), só loga e não tenta enviar.
export async function sendTransactionalEmail(input: SendEmailInput): Promise<void> {
  const client = getClient();
  if (!client) {
    console.warn(`[email] RESEND_API_KEY ausente — "${input.subject}" para ${maskEmail(input.to)} não enviado.`);
    return;
  }
  try {
    const { data, error } = await withTimeout(
      client.emails.send({ from: FROM_ADDRESS, to: input.to, subject: input.subject, html: input.html }),
      EMAIL_REQUEST_TIMEOUT_MS,
    );
    if (error) {
      console.error(`[email] falha ao enviar "${input.subject}" para ${maskEmail(input.to)}:`, error);
      return;
    }
    console.log(`[email] enviado "${input.subject}" para ${maskEmail(input.to)} (id=${data?.id ?? "?"})`);
  } catch (err) {
    console.error(`[email] falha ao enviar "${input.subject}" para ${maskEmail(input.to)}:`, err instanceof Error ? err.message : err);
  }
}
