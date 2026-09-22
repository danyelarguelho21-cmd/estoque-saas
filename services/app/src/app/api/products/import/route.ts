import { Queue } from "bullmq";
import { QUEUE_NAMES, ValidationError, defaultFileStorage, redisConnectionOptions, type ImportProductsCsvJobData } from "@estoque-saas/shared";
import { requireRole } from "@/modules/auth";
import { accepted, handleRoute } from "@/lib/http";

const importQueue = new Queue<ImportProductsCsvJobData>(QUEUE_NAMES.importProductsCsv, { connection: redisConnectionOptions() });

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:write");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError("Campo 'file' é obrigatório.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileRef = await defaultFileStorage.save(buffer, file.name);
    const job = await importQueue.add("import-products-csv", { tenantId: ctx.tenantId, fileRef });

    return accepted({ importJobId: job.id });
  });
}
