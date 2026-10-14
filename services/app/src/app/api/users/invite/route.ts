import { z } from "zod";
import { inviteUser, requireRole } from "@/modules/auth";
import { ROLES } from "@estoque-saas/shared";
import { created, handleRoute, parseJsonBody } from "@/lib/http";
import { publicBaseUrl } from "@/lib/public-url";

const InviteSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(ROLES),
});

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("users:manage");
    const input = await parseJsonBody(req, InviteSchema);
    const result = await inviteUser(ctx.tenantId, input, { baseUrl: publicBaseUrl(req) });
    return created(result);
  });
}
