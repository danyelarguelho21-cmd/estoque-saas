import { Queue } from "bullmq";
import { QUEUE_NAMES, ValidationError, redisConnectionOptions, type ParseNfeJobData } from "@estoque-saas/shared";
import { requireRole } from "@/modules/auth";
import { uploadNfeImport } from "@/modules/stock";
import { accepted, handleRoute } from "@/lib/http";

const parseNfeQueue = new Queue<ParseNfeJobData>(QUEUE_NAMES.parseNfe, { connection: redisConnectionOptions() });

// Upload de XML de NF-e (api/openapi/stock.yaml#uploadNfeImport) — multipart/form-data.
// Só grava o arquivo + enfileira o job de parsing; nunca faz parsing síncrono (ADR-005).
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("stock:write");
    const form = await req.formData();
    const file = form.get("file");
    const storeId = form.get("storeId");

    if (!(file instanceof File) || typeof storeId !== "string" || !storeId) {
      throw new ValidationError("Campos 'file' e 'storeId' são obrigatórios.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { importId } = await uploadNfeImport(ctx.tenantId, storeId, buffer, file.name);

    await parseNfeQueue.add("parse-nfe", { tenantId: ctx.tenantId, importId }, { jobId: importId });

    return accepted({ importId });
  });
}
