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
