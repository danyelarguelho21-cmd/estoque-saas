import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "@/modules/auth";
import { UnauthorizedError } from "@estoque-saas/shared";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const input = await parseJsonBody(req, LoginSchema);
    try {
      // redirect:false — Route Handler devolve JSON, não um redirect de página (contrato da API).
      await signIn("credentials", { ...input, redirect: false });
    } catch (err) {
      if (err instanceof AuthError) {
        throw new UnauthorizedError("E-mail ou senha inválidos.");
      }
      throw err;
    }
    return ok({ status: "ok" });
  });
}
