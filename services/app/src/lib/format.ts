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
