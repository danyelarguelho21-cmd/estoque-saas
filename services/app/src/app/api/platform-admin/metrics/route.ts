import { getPlatformMetrics, requirePlatformAdmin } from "@/modules/admin";
import { handleRoute, ok } from "@/lib/http";

export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    await requirePlatformAdmin();
    return ok(await getPlatformMetrics());
  });
}
