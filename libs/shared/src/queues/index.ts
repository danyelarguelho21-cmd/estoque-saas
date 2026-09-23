// Nomes de fila compartilhados entre o processo web (enfileira) e o worker (processa) — evita
// strings mágicas duplicadas em dois lugares (services/app/src/app/api/** e
// services/app/src/worker/index.ts).
export const QUEUE_NAMES = {
  parseNfe: "parse-nfe",
  generateMonthlyCharge: "generate-monthly-charge",
  scanExpiryAlerts: "scan-expiry-alerts",
  // Fila adicional (fora dos 3 processors originalmente estubados) — suporta
  // catalog.yaml#importProductsCsv (BRD: "CSV bulk import (async job)").
  importProductsCsv: "import-products-csv",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface ParseNfeJobData {
  tenantId: string;
  importId: string;
}

// Job diário/repeatable, sem parâmetro por tenant — o processor varre todos os tenants com
// assinatura pix_boleto ativa e período vencido (ver worker/index.ts). Manter `tenantId` opcional
// permite reenfileirar manualmente para UM tenant específico (ex: retry pontual) sem mudar o shape.
export interface GenerateMonthlyChargeJobData {
  tenantId?: string;
}

export interface ImportProductsCsvJobData {
  tenantId: string;
  fileRef: string;
}

export type ScanExpiryAlertsJobData = Record<string, never>;

export function redisConnectionOptions(): { url: string } {
  return { url: process.env.REDIS_URL ?? "redis://localhost:6379" };
}

// code-reviewer finding HI-2: none of the four `new Queue(...)` call sites passed
// `defaultJobOptions` — BullMQ's bare default for a job with no `attempts` is a single attempt,
// no retry, so a worker restart mid-job or a transient Postgres/Redis blip permanently drops the
// job (an NF-e upload silently stuck, a tenant's daily billing charge silently skipped, a day of
// expiry alerts silently never firing). Every queue in the tree should set this — pass to
// `new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS })`.
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
} as const;
