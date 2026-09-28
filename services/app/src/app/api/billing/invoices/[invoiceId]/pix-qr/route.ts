import { requireRole } from "@/modules/auth";
import { getPixQrCodeImage } from "@/modules/billing";
import { handleRoute } from "@/lib/http";

export async function GET(
  _req: Request,
  context: { params: Promise<{ invoiceId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("billing:manage", { allowPendingPayment: true });
    const { invoiceId } = await context.params;
    const image = await getPixQrCodeImage(ctx.tenantId, invoiceId);
    if (!image) return Response.json({ code: "not_found", message: "QR Code Pix não encontrado." }, { status: 404 });
    return new Response(Buffer.from(image), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
    });
  });
}
