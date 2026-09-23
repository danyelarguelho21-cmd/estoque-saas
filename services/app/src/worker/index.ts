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

const parseNfeWorker = new Worker<ParseNfeJobData>(
  QUEUE_NAMES.parseNfe,
  async (job) => {
    await processNfeImportJob(job.data.tenantId, job.data.importId);
  },
  { connection },
);
console.log(`[worker] escutando fila: ${QUEUE_NAMES.parseNfe}`);

const monthlyChargeWorker = new Worker<GenerateMonthlyChargeJobData>(
  QUEUE_NAMES.generateMonthlyCharge,
  async () => {
    const result = await generateMonthlyCharges();
    console.log(`[worker] generate-monthly-charge: ${result.generated} cobranças geradas, ${result.skipped} tenants sem cobrança pendente.`);
  },
  { connection },
);
console.log(`[worker] escutando fila: ${QUEUE_NAMES.generateMonthlyCharge}`);

const expiryAlertsWorker = new Worker<ScanExpiryAlertsJobData>(
  QUEUE_NAMES.scanExpiryAlerts,
  async () => {
    const result = await scanExpiryAndLowStockAlerts();
    console.log(`[worker] scan-expiry-alerts: ${result.tenantsScanned} tenants varridos, ${result.notificationsCreated} notificações criadas.`);
  },
  { connection },
);
console.log(`[worker] escutando fila: ${QUEUE_NAMES.scanExpiryAlerts}`);

const importProductsWorker = new Worker<ImportProductsCsvJobData>(
  QUEUE_NAMES.importProductsCsv,
  async (job) => {
    const buffer = await defaultFileStorage.read(job.data.fileRef);
    const result = await processProductsCsvJob(job.data.tenantId, buffer.toString("utf8"));
    console.log(`[worker] import-products-csv: ${result.created} criados, ${result.skipped} ignorados (SKU já existente).`);
  },
  { connection },
);
console.log(`[worker] escutando fila: ${QUEUE_NAMES.importProductsCsv}`);

const allWorkers = [parseNfeWorker, monthlyChargeWorker, expiryAlertsWorker, importProductsWorker];

// sre finding (T9b, readiness-review-ship.md §2): sem handler de SIGTERM, um `docker compose
// stop`/restart de deploy (cd-production.yml) mata o processo direto após o
// `stop_grace_period` padrão do Docker (10s) — qualquer job em andamento (parse de NF-e, geração
// de cobrança, webhook) é morto no meio, não drenado. `Worker.close()` do BullMQ espera o job
// ATUAL de cada worker terminar antes de resolver (não aceita mais jobs novos enquanto isso) —
// use com `stop_grace_period` elevado no compose (worker: 60s, ver docker-compose.yml) para dar
// tempo real de a maioria dos jobs terminar antes do SIGKILL.
async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} recebido — drenando jobs em andamento antes de encerrar...`);
  await Promise.allSettled(allWorkers.map((w) => w.close()));
  console.log("[worker] todos os workers fechados, encerrando.");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

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
