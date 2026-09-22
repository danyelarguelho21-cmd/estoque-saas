import { z } from "zod";
import { platformAdminLogin } from "@/modules/admin";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const input = await parseJsonBody(req, LoginSchema);
    await platformAdminLogin(input.email, input.password);
    return ok({ status: "ok" });
  });
}
