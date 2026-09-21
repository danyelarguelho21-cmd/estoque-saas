// Entrypoint do worker de background jobs (BullMQ) — mesma base de código do app web,
// processo separado (ver ADR-001 / docs/architecture/system-diagrams/c4-container.md).
//
// Jobs previstos (implementação na fase BUILD):
//  - parse-nfe: parsing assíncrono de XML de NF-e (ADR-005)
//  - generate-monthly-charge: geração de cobrança avulsa Pix/boleto (sequence-billing.md)
//  - scan-expiry-alerts: varredura diária de lotes vencendo + estoque baixo (ADR-006)

import { Worker } from "bullmq";

const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

const queues = ["parse-nfe", "generate-monthly-charge", "scan-expiry-alerts"] as const;

for (const queueName of queues) {
  new Worker(
    queueName,
    async (job) => {
      throw new Error(`TODO(BUILD): implementar processor do job '${queueName}' (job ${job.id})`);
    },
    { connection },
  );
  console.log(`[worker] escutando fila: ${queueName}`);
}
