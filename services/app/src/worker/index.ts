// Entrypoint do worker de background jobs (BullMQ) — mesma base de código do app web,
// processo separado (ver ADR-001 / docs/architecture/system-diagrams/c4-container.md).
//
// Jobs:
//  - parse-nfe: parsing assíncrono de XML de NF-e (ADR-005)
//  - generate-monthly-charge: geração de cobrança avulsa Pix/boleto (sequence-billing.md)
//  - scan-expiry-alerts: varredura diária de lotes vencendo + estoque baixo (ADR-006)
//  - import-products-csv: importação em lote de produtos via CSV (catalog.yaml#importProductsCsv)

import { Queue, Worker } from "bullmq";
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
  defaultFileStorage,
  redisConnectionOptions,
  type GenerateMonthlyChargeJobData,
  type ImportProductsCsvJobData,
  type ParseNfeJobData,
  type ScanExpiryAlertsJobData,
} from "@estoque-saas/shared";
import { generateMonthlyCharges } from "@/modules/billing";
import { processProductsCsvJob } from "@/modules/catalog";
import { processNfeImportJob, scanExpiryAndLowStockAlerts } from "@/modules/stock";

const connection = redisConnectionOptions();

new Worker<ParseNfeJobData>(
  QUEUE_NAMES.parseNfe,
  async (job) => {
    await processNfeImportJob(job.data.tenantId, job.data.importId);
  },
  { connection },
);
console.log(`[worker] escutando fila: ${QUEUE_NAMES.parseNfe}`);

new Worker<GenerateMonthlyChargeJobData>(
  QUEUE_NAMES.generateMonthlyCharge,
  async () => {
    const result = await generateMonthlyCharges();
    console.log(`[worker] generate-monthly-charge: ${result.generated} cobranças geradas, ${result.skipped} tenants sem cobrança pendente.`);
  },
  { connection },
);
console.log(`[worker] escutando fila: ${QUEUE_NAMES.generateMonthlyCharge}`);

new Worker<ScanExpiryAlertsJobData>(
  QUEUE_NAMES.scanExpiryAlerts,
  async () => {
    const result = await scanExpiryAndLowStockAlerts();
    console.log(`[worker] scan-expiry-alerts: ${result.tenantsScanned} tenants varridos, ${result.notificationsCreated} notificações criadas.`);
  },
  { connection },
);
console.log(`[worker] escutando fila: ${QUEUE_NAMES.scanExpiryAlerts}`);

new Worker<ImportProductsCsvJobData>(
  QUEUE_NAMES.importProductsCsv,
  async (job) => {
    const buffer = await defaultFileStorage.read(job.data.fileRef);
    const result = await processProductsCsvJob(job.data.tenantId, buffer.toString("utf8"));
    console.log(`[worker] import-products-csv: ${result.created} criados, ${result.skipped} ignorados (SKU já existente).`);
  },
  { connection },
);
console.log(`[worker] escutando fila: ${QUEUE_NAMES.importProductsCsv}`);

// Agendamento (repeatable jobs) — generate-monthly-charge e scan-expiry-alerts rodam sozinhos,
// diariamente, sem depender de nenhum Route Handler para dispará-los (BullMQ garante que o
// repeatable job só é (re)criado uma vez — chamar .add() de novo com o mesmo jobId/pattern é
// idempotente, seguro de rodar a cada boot do worker).
async function scheduleRepeatableJobs(): Promise<void> {
  const monthlyChargeQueue = new Queue<GenerateMonthlyChargeJobData>(QUEUE_NAMES.generateMonthlyCharge, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  await monthlyChargeQueue.add(
    "generate-monthly-charge-daily",
    {},
    { repeat: { pattern: "0 6 * * *" }, jobId: "generate-monthly-charge-daily" }, // 06:00 diário
  );

  const expiryAlertsQueue = new Queue<ScanExpiryAlertsJobData>(QUEUE_NAMES.scanExpiryAlerts, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  await expiryAlertsQueue.add(
    "scan-expiry-alerts-daily",
    {},
    { repeat: { pattern: "0 7 * * *" }, jobId: "scan-expiry-alerts-daily" }, // 07:00 diário
  );

  console.log("[worker] jobs repetíveis agendados: generate-monthly-charge (06:00), scan-expiry-alerts (07:00).");
}

scheduleRepeatableJobs().catch((err) => {
  console.error("[worker] falha ao agendar jobs repetíveis:", err);
});
