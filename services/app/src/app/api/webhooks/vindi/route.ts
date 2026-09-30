import { processVindiWebhook } from "@/modules/billing";
import { handleRoute, ok } from "@/lib/http";

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const rawBody = await req.text();
    const secret = new URL(req.url).searchParams.get("secret");
    await processVindiWebhook(rawBody, secret);
    return ok({ status: "processed" });
  });
}
