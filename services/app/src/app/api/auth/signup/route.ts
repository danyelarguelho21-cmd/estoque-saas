import { z } from "zod";
import { signupTenant } from "@/modules/auth";
import { created, handleRoute, parseJsonBody } from "@/lib/http";

const SignupSchema = z.object({
  companyName: z.string().min(1),
  cnpj: z.string().min(1),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  password: z.string().min(8),
  planId: z.string().uuid(),
});

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const input = await parseJsonBody(req, SignupSchema);
    const result = await signupTenant(input);
    return created(result);
  });
}
