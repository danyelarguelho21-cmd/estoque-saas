/** Formatação pt-BR — moeda, data e números — compartilhada por toda a UI. */

/** Recebe valor em centavos (padrão da API, ex: salePriceCents) e formata como BRL. */
export function formatCentsToBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatDateBR(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

export function formatDateTimeBR(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function formatNumberBR(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

/**
 * Dias até uma data (positivo = futuro, negativo = já venceu).
 *
 * `dateStr` é sempre uma data-calendário (YYYY-MM-DD, ex: batches.expiry_date da API — Postgres
 * `date`, sem componente de hora). `new Date(dateStr)` interpretaria isso como meia-noite UTC;
 * `.setHours(0,0,0,0)` depois opera em horário LOCAL — em qualquer fuso atrás de UTC (ex:
 * America/Cuiaba, UTC-4) isso desloca a data em -1 dia (bug real encontrado pelo teste
 * "returns 0 for today" após o merge das Waves — ver Claude-Production-Grade-Suite/.orchestrator/
 * loops/ para o registro). Construímos `target` direto a partir dos componentes ano/mês/dia em
 * horário LOCAL (`new Date(year, month-1, day)`), nunca via parsing de string + conversão.
 */
export function daysUntil(dateStr: string): number {
  const parts = dateStr.slice(0, 10).split("-").map(Number);
  const [year = NaN, month = NaN, day = NaN] = parts;
  const target = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function cnpjMask(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/**
 * Valida o dígito verificador do CNPJ (algoritmo oficial da Receita Federal, módulo 11).
 *
 * Achado ao vivo (24/09/2026): a máscara (`cnpjMask`) só formata a digitação, nunca validou o
 * check digit — um CNPJ com dígito errado passava no cadastro sem aviso, e só ia falhar dias
 * depois, no worker, quando o PagBank rejeitasse a cobrança com "customer.tax_id must be a valid
 * CPF or CNPJ" (tarde demais para o lojista corrigir na hora). Aceita a string com ou sem máscara.
 */
export function isValidCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  // Todos os dígitos iguais (ex.: "00000000000000") passam no cálculo do módulo 11 mas não são
  // CNPJs válidos — a Receita Federal rejeita esses explicitamente.
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calcCheckDigit = (base: string, weights: number[]): number => {
    const sum = base
      .split("")
      .reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const first12 = digits.slice(0, 12);
  const digit13 = calcCheckDigit(first12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const digit14 = calcCheckDigit(first12 + digit13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return digits === `${first12}${digit13}${digit14}`;
}
