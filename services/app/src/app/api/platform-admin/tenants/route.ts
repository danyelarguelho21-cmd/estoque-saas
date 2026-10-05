import { z } from "zod";
import { createTenantByAdmin, listTenantsAdmin, requirePlatformAdmin } from "@/modules/admin";
import { created, handleRoute, ok, parseJsonBody, parseQuery } from "@/lib/http";
import { isValidCnpj, isValidCpf } from "@/lib/format";

const QuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  subscriptionStatus: z.enum(["pending_payment", "trialing", "active", "past_due", "canceled"]).optional(),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    await requirePlatformAdmin();
    const filters = parseQuery(new URL(req.url).searchParams, QuerySchema);
    return ok(await listTenantsAdmin(filters));
  });
}

const AccessSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("courtesy") }),
  z.object({ type: z.literal("trial"), days: z.number().int().min(1).max(90) }),
  z.object({ type: z.literal("pending") }),
]);

const BaseTenantFields = {
  companyName: z.string().trim().min(1),
  adminName: z.string().trim().min(1),
  adminEmail: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  planId: z.string().uuid(),
  access: AccessSchema,
};

const CreateTenantSchema = z.discriminatedUnion("personType", [
  z.object({ personType: z.literal("PJ"), cnpj: z.string().min(1).refine(isValidCnpj, { message: "CNPJ inválido." }), ...BaseTenantFields }),
  z.object({ personType: z.literal("PF"), cpf: z.string().min(1).refine(isValidCpf, { message: "CPF inválido." }), ...BaseTenantFields }),
]);

// Cadastro manual de cliente pelo dono da plataforma (cortesia, teste ou pagamento normal).
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    await requirePlatformAdmin();
    const input = await parseJsonBody(req, CreateTenantSchema);
    const result = await createTenantByAdmin(
      {
        companyName: input.companyName,
        personType: input.personType,
        cnpj: input.personType === "PJ" ? input.cnpj : null,
        cpf: input.personType === "PF" ? input.cpf : null,
        adminName: input.adminName,
        adminEmail: input.adminEmail,
        password: input.password,
        planId: input.planId,
      },
      input.access,
    );
    return created(result);
  });
}
