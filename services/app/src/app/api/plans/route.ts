import { listPlans } from "@/modules/billing";
import { handleRoute, ok } from "@/lib/http";

export async function GET(): Promise<Response> {
  return handleRoute(async () => ok(await listPlans()));
}
