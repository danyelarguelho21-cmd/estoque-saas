import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { createCategory, listCategories } from "@/modules/catalog";
import { created, handleRoute, ok, parseJsonBody } from "@/lib/http";

export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:read");
    return ok(await listCategories(ctx.tenantId));
  });
}

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:write");
    const { name } = await parseJsonBody(req, z.object({ name: z.string().min(1) }));
    return created(await createCategory(ctx.tenantId, name));
  });
}
