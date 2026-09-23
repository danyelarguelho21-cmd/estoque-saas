import { Queue } from "bullmq";
import {
  DEFAULT_JOB_OPTIONS,
  MAX_CSV_UPLOAD_BYTES,
  QUEUE_NAMES,
  ValidationError,
  assertUploadSizeWithinLimit,
  defaultFileStorage,
  redisConnectionOptions,
  type ImportProductsCsvJobData,
} from "@estoque-saas/shared";
import { requireRole } from "@/modules/auth";
import { accepted, handleRoute } from "@/lib/http";

const importQueue = new Queue<ImportProductsCsvJobData>(QUEUE_NAMES.importProductsCsv, {
  connection: redisConnectionOptions(),
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

// security-engineer finding H-3: mesmo raciocínio de /api/nfe-imports — worker compartilhado
// entre todos os tenants (ADR-001), upload sem limite era um vetor de DoS cross-tenant.
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:write");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError("Campo 'file' é obrigatório.");
    }
    assertUploadSizeWithinLimit(file.size, MAX_CSV_UPLOAD_BYTES);

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileRef = await defaultFileStorage.save(buffer, file.name);
    const job = await importQueue.add("import-products-csv", { tenantId: ctx.tenantId, fileRef });

    return accepted({ importJobId: job.id });
  });
}
